/**
 * Hermes Client for fetching Pyth price data
 *
 * This client fetches AKT/USD price data from Pyth's Hermes API
 * and submits it to the Akash Pyth contract.
 *
 * The Pyth contract:
 * 1. Receives the VAA (Verified Action Approval) from this client
 * 2. Verifies VAA signatures via Wormhole contract
 * 3. Parses Pyth price attestation from VAA payload
 * 4. Relays validated price to x/oracle module
 */

import { SigningCosmWasmClient } from "@cosmjs/cosmwasm-stargate";
import { DirectSecp256k1HdWallet, DirectSecp256k1Wallet, type OfflineDirectSigner } from "@cosmjs/proto-signing";
import { GasPrice } from "@cosmjs/stargate";
import {
    validateEndpointUrl,
    validateAkashAddress,
    validateContractAddress,
    validateFeeAmount,
    sanitizeErrorMessage,
    validateWalletSecret,
} from "./validation.ts";

export interface HermesConfig {
    /**
     * Allows insecure endpoint URLs (HTTP, private/internal addresses).
     * @default false
     */
    unsafeAllowInsecureEndpoints?: boolean;
    rpcEndpoint: string;
    contractAddress: string;
    walletSecret:
        | {
            type: "mnemonic";
            /** mnemonic phrase for wallet */
            value: string;
        }
        | {
            type: "privateKey";
            /** hex-encoded private key for wallet */
            value: string;
        };
    hermesEndpoint: string;
    updateIntervalMs: number;
    denom?: string;
    gasPrice?: string;
    /**
     * Optional threshold for skipping updates when the price change is below a tolerance.
     *
     * - For `type: "absolute"`, `value` is an absolute price difference in quote currency units
     *   (e.g. `0.5` means $0.50 if the quote currency is USD).
     * - For `type: "percentage"`, `value` is a number from 0 to 100
     *   (e.g. `10` = 10%, `0.1` = 0.1%).
     */
    priceDeviationTolerance?: {
        type: "absolute" | "percentage";
        value: number;
    };
    /**
     * `fetch` implementation to use for HTTP requests. Defaults to globalThis.fetch.
     */
    fetch?: typeof globalThis.fetch;
    /**
     * Optional logger for informational messages. Should implement log, error, and warn methods.
     */
    logger?: Pick<Console, "log" | "error" | "warn">;
    /**
     * Optional custom connectWithSigner function for testing or advanced use cases. Defaults to SigningCosmWasmClient.connectWithSigner.
     */
    connectWithSigner?: typeof SigningCosmWasmClient.connectWithSigner;
}

// Pyth price data from Hermes API
interface PythPriceData {
    id: string;
    price: {
        price: string;
        conf: string;
        expo: number;
        publish_time: number;
    };
    ema_price: {
        price: string;
        conf: string;
        expo: number;
        publish_time: number;
    };
}

// Hermes API response with VAA binary data
export interface HermesResponse {
    binary: {
        // Base64 encoded VAA data array
        data: string[];
    };
    parsed: PythPriceData[];
}

// =====================
// Contract Execute Messages
// Matches pyth contract msg.rs
// =====================

interface UpdatePriceFeedMsg {
    update_price_feed: {
        // VAA data from Pyth Hermes API (base64 encoded Binary)
        // The Pyth contract will:
        // 1. Verify VAA via Wormhole contract
        // 2. Parse Pyth price attestation from payload
        // 3. Relay to x/oracle module
        vaa: string;
    };
}

interface UpdateFeeMsg {
    update_fee: {
        new_fee: string;      // Uint256 serializes as string in JSON
    };
}

interface TransferAdminMsg {
    transfer_admin: {
        new_admin: string;
    };
}

interface RefreshOracleParamsMsg {
    refresh_oracle_params: Record<string, never>;
}

// =====================
// Contract Query Responses
// Matches Pyth contract msg.rs
// =====================

interface DataSourceResponse {
    emitter_chain: number;    // u16 - Wormhole chain ID (26 for Pythnet)
    emitter_address: string;  // 32 bytes hex encoded
}

interface ConfigResponse {
    admin: string;
    wormhole_contract: string;
    update_fee: string;       // Uint256 serializes as string
    price_feed_id: string;
    default_denom: string;
    default_base_denom: string;
    data_sources: DataSourceResponse[];
}

interface PriceResponse {
    price: string;            // Uint128 serializes as string
    conf: string;             // Uint128 serializes as string
    expo: number;             // i32
    publish_time: number;     // i64
}

interface PriceFeedResponse {
    symbol: string;
    price: string;            // Uint128 serializes as string
    conf: string;             // Uint128 serializes as string
    expo: number;             // i32
    publish_time: number;     // i64
    prev_publish_time: number; // i64
}

interface PriceFeedIdResponse {
    price_feed_id: string;
}

interface OracleParamsResponse {
    max_price_deviation_bps: number;    // u64
    min_price_sources: number;          // u32
    max_price_staleness_blocks: number; // i64
    twap_window: number;                // i64
    last_updated_height: number;        // u64
}

const DEFAULT_PRICE_DEVIATION_TOLERANCE: Required<HermesConfig>["priceDeviationTolerance"] = { type: "absolute", value: 0 };

export class HermesClient {
    #cosmClient?: SigningCosmWasmClient;
    #wallet?: OfflineDirectSigner;
    #senderAddress?: string;
    readonly #config: Required<Omit<HermesConfig, "fetch" | "logger" | "connectWithSigner">>;
    #priceFeedId?: string;
    #isRunning = false;
    #updateTimer?: NodeJS.Timeout;
    #fetch: Exclude<HermesConfig["fetch"], undefined>;
    #logger: Exclude<HermesConfig["logger"], undefined>;
    #connectWithSigner: typeof SigningCosmWasmClient.connectWithSigner;

    static async connect(config: HermesConfig): Promise<HermesClient> {
        const client = new HermesClient(config);
        await client.initialize();
        return client;
    }

    constructor(config: HermesConfig) {
        const unsafeAllowInsecureEndpoints = config.unsafeAllowInsecureEndpoints ?? false;

        validateEndpointUrl(config.rpcEndpoint, "RPC endpoint", !unsafeAllowInsecureEndpoints);
        validateEndpointUrl(config.hermesEndpoint, "Hermes endpoint", !unsafeAllowInsecureEndpoints);
        validateWalletSecret(config.walletSecret);
        validateContractAddress(config.contractAddress);

        this.#config = {
            ...config,
            denom: config.denom ?? "uakt",
            gasPrice: config.gasPrice ?? "0.025uakt",
            unsafeAllowInsecureEndpoints,
            priceDeviationTolerance: config.priceDeviationTolerance ?? DEFAULT_PRICE_DEVIATION_TOLERANCE,
        };
        this.#fetch = config.fetch ?? globalThis.fetch;
        this.#logger = config.logger ?? console;
        this.#connectWithSigner = config.connectWithSigner ?? SigningCosmWasmClient.connectWithSigner;
    }

    /**
     * Initialize the client and connect to the chain
     */
    async initialize(): Promise<void> {
        try {
            this.#logger.log("Initializing Hermes client...");

            this.#wallet = await this.#createWallet(this.#config.walletSecret);

            const [account] = await this.#wallet.getAccounts();
            this.#senderAddress = account.address;
            this.#logger.log(`Using address: ${this.#senderAddress}`);

            this.#cosmClient = await this.#connectWithSigner(
                this.#config.rpcEndpoint,
                this.#wallet,
                {
                    gasPrice: GasPrice.fromString(this.#config.gasPrice),
                },
            );
            this.#logger.log("Connected to chain successfully");

            await this.#fetchPriceFeedId();

            this.#logger.log("Hermes client initialized successfully");
        } catch (error) {
            // SEC-04: Sanitize error messages to prevent information leakage
            const safeMessage = sanitizeErrorMessage(error, "Failed to initialize Hermes client");
            this.#logger.error(safeMessage);
            throw new Error(safeMessage);
        }
    }

    #createWallet(secret: HermesConfig["walletSecret"]): Promise<OfflineDirectSigner> {
        const prefix = "akash";
        if (secret.type === "mnemonic") {
            return DirectSecp256k1HdWallet.fromMnemonic(secret.value, { prefix });
        }

        const privateKeyBytes = Buffer.from(secret.value, "hex");
        return DirectSecp256k1Wallet.fromKey(privateKeyBytes, prefix);
    }

    /**
     * Fetch the price feed ID from the contract
     */
    async #fetchPriceFeedId(): Promise<void> {
        const config: ConfigResponse = await this.#getCosmClient().queryContractSmart(
            this.#config.contractAddress,
            { get_config: {} },
        );

        this.#priceFeedId = config.price_feed_id;
        this.#logger.log(`Using Pyth Price Feed ID: ${this.#priceFeedId}`);
        this.#logger.log(`Update fee: ${config.update_fee} ${this.#config.denom}`);
    }

    /**
     * Fetch latest price data with VAA from Hermes
     * Returns both parsed price data (for logging) and raw VAA (for contract)
     */
    async #fetchPriceFromHermes(): Promise<{
        priceData: PythPriceData;
        vaa: string;
    }> {
        if (!this.#priceFeedId) {
            throw new Error("Price feed ID not loaded");
        }

        // Request base64 encoding for VAA data (compatible with CosmWasm Binary)
        const params = new URLSearchParams({
            "ids[]": this.#priceFeedId,
            encoding: "base64",
        });
        const response = await this.#fetch(`${this.#config.hermesEndpoint}/v2/updates/price/latest?${params.toString()}`);

        if (!response.ok) {
            const statusText = response.status ? ` (HTTP ${response.status})` : "";
            throw new Error(
                `Failed to fetch from Hermes${statusText}: price data unavailable`,
            );
        }

        const data = await response.json() as HermesResponse;

        if (!data.parsed || data.parsed.length === 0) {
            throw new Error("No price data returned from Hermes");
        }

        if (!data.binary?.data || data.binary.data.length === 0) {
            throw new Error("No VAA binary data returned from Hermes");
        }

        const priceData: PythPriceData = data.parsed[0];
        const vaa: string = data.binary.data[0];

        this.#logger.log(
            `Fetched price from Hermes: ${priceData.price.price} (expo: ${priceData.price.expo})`,
        );
        this.#logger.log(
            `  Confidence: ${priceData.price.conf}, Publish time: ${priceData.price.publish_time}`,
        );
        this.#logger.log(
            `  VAA size: ${vaa.length} bytes (base64)`,
        );

        return { priceData, vaa };
    }

    #getCosmClient(): SigningCosmWasmClient {
        if (!this.#cosmClient) {
            throw new Error("Client not initialized");
        }
        return this.#cosmClient;
    }

    /**
     * Query current price from contract
     */
    async queryCurrentPrice(): Promise<PriceResponse> {
        const price: PriceResponse = await this.#getCosmClient().queryContractSmart(
            this.#config.contractAddress,
            { get_price: {} },
        );

        return price;
    }

    /**
     * Query current price feed with metadata from contract
     */
    async queryPriceFeed(): Promise<PriceFeedResponse> {
        const feed: PriceFeedResponse = await this.#getCosmClient().queryContractSmart(
            this.#config.contractAddress,
            { get_price_feed: {} },
        );

        return feed;
    }

    /**
     * Query contract configuration
     */
    async queryConfig(): Promise<ConfigResponse> {
        const config: ConfigResponse = await this.#getCosmClient().queryContractSmart(
            this.#config.contractAddress,
            { get_config: {} },
        );

        return config;
    }

    /**
     * Query cached oracle parameters from contract
     */
    async queryOracleParams(): Promise<OracleParamsResponse> {
        const params: OracleParamsResponse = await this.#getCosmClient().queryContractSmart(
            this.#config.contractAddress,
            { get_oracle_params: {} },
        );

        return params;
    }

    /**
     * Refresh cached oracle parameters (admin only)
     */
    async refreshOracleParams(): Promise<string> {
        if (!this.#senderAddress) {
            throw new Error("Client not initialized");
        }

        const msg: RefreshOracleParamsMsg = {
            refresh_oracle_params: {},
        };

        const result = await this.#getCosmClient().execute(
            this.#senderAddress,
            this.#config.contractAddress,
            msg,
            "auto",
        );

        return result.transactionHash;
    }

    /**
     * Update the update fee (admin only)
     */
    async updateFee(newFee: string): Promise<string> {
        // SEC-06: Validate fee format before any operation
        validateFeeAmount(newFee);

        if (!this.#senderAddress) {
            throw new Error("Client not initialized");
        }

        const msg: UpdateFeeMsg = {
            update_fee: {
                new_fee: newFee,
            },
        };

        const result = await this.#getCosmClient().execute(
            this.#senderAddress,
            this.#config.contractAddress,
            msg,
            "auto",
        );

        return result.transactionHash;
    }

    /**
     * Transfer admin rights (admin only)
     */
    async transferAdmin(newAdmin: string): Promise<string> {
        // SEC-05: Validate address format before any operation
        validateAkashAddress(newAdmin);

        if (!this.#senderAddress) {
            throw new Error("Client not initialized");
        }

        const msg: TransferAdminMsg = {
            transfer_admin: {
                new_admin: newAdmin,
            },
        };

        const result = await this.#getCosmClient().execute(
            this.#senderAddress,
            this.#config.contractAddress,
            msg,
            "auto",
        );

        return result.transactionHash;
    }

    /**
     * Update the oracle contract with new price data
     *
     * Flow:
     * 1. Fetch price + VAA from Pyth Hermes API
     * 2. Check if price is newer than current (optimization)
     * 3. Send VAA to Pyth contract
     * 4. Contract verifies VAA via Wormhole, parses Pyth payload, relays to x/oracle
     */
    async updatePrice(): Promise<void> {
        if (!this.#senderAddress) {
            throw new Error("Client not initialized");
        }

        try {
            const { priceData, vaa } = await this.#fetchPriceFromHermes();
            const currentPrice = await this.queryCurrentPrice();

            if (this.#canIgnorePriceUpdate(priceData, currentPrice)) {
                return;
            }

            // Prepare execute message with VAA
            // The contract will:
            // 1. Verify VAA via Wormhole contract
            // 2. Parse Pyth price attestation from VAA payload
            // 3. Validate price feed ID matches expected
            // 4. Relay validated price to x/oracle module
            const msg: UpdatePriceFeedMsg = {
                update_price_feed: {
                    vaa: vaa,
                },
            };

            // Get config to determine update fee
            const config: ConfigResponse = await this.#getCosmClient().queryContractSmart(
                this.#config.contractAddress,
                { get_config: {} },
            );

            // Execute update
            this.#logger.log("Submitting VAA to Pyth contract...");
            this.#logger.log(`  Wormhole contract: ${config.wormhole_contract}`);
            const result = await this.#getCosmClient().execute(
                this.#senderAddress,
                this.#config.contractAddress,
                msg,
                "auto",
                undefined,
                [{ denom: this.#config.denom, amount: config.update_fee }],
            );

            this.#logger.log(`Price updated successfully! TX: ${result.transactionHash}`);
            this.#logger.log(`  Gas used: ${result.gasUsed}`);
            this.#logger.log(`  New price: ${priceData.price.price} (expo: ${priceData.price.expo})`);
        } catch (error) {
            // SEC-04: Sanitize error messages to prevent information leakage
            const safeMessage = sanitizeErrorMessage(error, "Failed to update price");
            this.#logger.error(safeMessage);
            throw new Error(safeMessage);
        }
    }

    #canIgnorePriceUpdate(newPrice: PythPriceData, currentPrice: PriceResponse): boolean {
        if (newPrice.price.publish_time <= currentPrice.publish_time) {
            this.#logger.log(
                `Price already up to date (publish_time: ${currentPrice.publish_time})`,
            );
            return true;
        }

        if (this.#isPriceDeviationAcceptable(newPrice, currentPrice)) {
            return true;
        }

        return false;
    }

    #isPriceDeviationAcceptable(newPrice: PythPriceData, currentPrice: PriceResponse): boolean {
        const newPriceValue = parseFloat(newPrice.price.price) * Math.pow(10, newPrice.price.expo);
        const currentPriceValue = parseFloat(currentPrice.price) * Math.pow(10, currentPrice.expo);
        let isAcceptable = false;

        this.#logger.log(`Checking if price deviation is acceptable: new=${newPriceValue}, current=${currentPriceValue}`);

        if (this.#config.priceDeviationTolerance.type === "absolute") {
            const deviation = Math.abs(newPriceValue - currentPriceValue);
            isAcceptable = deviation <= this.#config.priceDeviationTolerance.value;

            if (isAcceptable) {
                this.#logger.log(`Price deviation ${deviation} within absolute tolerance ${this.#config.priceDeviationTolerance.value}, skipping update`);
            }
        } else if (this.#config.priceDeviationTolerance.type === "percentage") {
            const deviationPercent = currentPriceValue === 0 ? Number.MAX_SAFE_INTEGER : Math.abs(newPriceValue - currentPriceValue) / currentPriceValue;
            isAcceptable = deviationPercent <= this.#config.priceDeviationTolerance.value / 100;
            if (isAcceptable) {
                this.#logger.log(`Price deviation ${(deviationPercent * 100).toFixed(2)}% within percentage tolerance ${(this.#config.priceDeviationTolerance.value).toFixed(2)}%, skipping update`);
            }
        } else {
            throw new Error(`Unknown price deviation tolerance type: ${this.#config.priceDeviationTolerance.type}`);
        }

        return isAcceptable;
    }

    /**
     * Start automatic price updates
     */
    async start(options?: { signal?: AbortSignal }): Promise<void> {
        if (this.#isRunning) {
            this.#logger.log("Hermes client is already running");
            return;
        }

        // important to be set before any async operation to prevent multiple concurrent starts
        this.#isRunning = true;

        options?.signal?.addEventListener("abort", () => {
            if (this.#updateTimer) {
                clearTimeout(this.#updateTimer);
                this.#updateTimer = undefined;
            }
            this.#isRunning = false;
            this.#logger.log("Hermes client stopped");
        }, { once: true });

        try {
            if (!this.#cosmClient) {
                await this.initialize();
            }

            this.#logger.log(
                `Starting automatic updates every ${this.#config.updateIntervalMs / 1000}s`,
            );

            const updatePrice = async () => {
                if (!this.#isRunning) return;
                try {
                    await this.updatePrice();
                } catch (error) {
                    this.#logger.error("Error in scheduled update:", error);
                } finally {
                    this.#updateTimer = undefined;
                }
                if (this.#isRunning) {
                    this.#updateTimer = setTimeout(updatePrice, this.#config.updateIntervalMs);
                }
            };

            // Initial update + Schedule periodic updates
            await updatePrice();
        } catch (error) {
            this.#isRunning = false;
            const safeMessage = sanitizeErrorMessage(error, "Failed to start Hermes client");
            this.#logger.error(safeMessage);
            throw new Error(safeMessage);
        }
    }

    /**
     * Get client status
     */
    getStatus(): {
        isRunning: boolean;
        address?: string;
        priceFeedId?: string;
        contractAddress: string;
    } {
        // SEC-08: Only return non-sensitive operational status fields.
        // Never include mnemonic, gasPrice, rpcEndpoint, or full config.
        return {
            isRunning: this.#isRunning,
            address: this.#senderAddress,
            priceFeedId: this.#priceFeedId,
            contractAddress: this.#config.contractAddress,
        };
    }
}

// Export types for external use
export type {
    PythPriceData,
    DataSourceResponse,
    UpdatePriceFeedMsg,
    UpdateFeeMsg,
    TransferAdminMsg,
    RefreshOracleParamsMsg,
    ConfigResponse,
    PriceResponse,
    PriceFeedResponse,
    PriceFeedIdResponse,
    OracleParamsResponse,
};

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
import { priceUpdateCounter, blockchainPriceStaleness } from "./metrics.ts";
import { latestValue } from "./price-stream/latest-value/latest-value.ts";
import { PriceUpdateConfirmed } from "./price-update/price-update-confirmed/price-update-confirmed.ts";
import type { Logger, PriceProducerFactory, PriceUpdate, PriceUpdater, PythPriceData } from "./types.ts";
import {
    sanitizeErrorMessage,
    validateAkashAddress,
    validateContractAddress,
    validateEndpointUrl,
    validateFeeAmount,
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
    denom?: string;
    gasPrice?: string;
    smartContractConfigCacheTTLMs: number;
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
     * Factory function to create a price producer (AsyncGenerator) that yields price updates.
     * This allows for different implementations of price fetching logic (e.g. polling, SSE).
     */
    priceProducerFactory: PriceProducerFactory;
    /**
     * Optional logger for informational messages. Should implement log, error, and warn methods.
     */
    logger?: Logger;
    /**
     * Optional custom connectWithSigner function for testing or advanced use cases. Defaults to SigningCosmWasmClient.connectWithSigner.
     */
    connectWithSigner?: typeof SigningCosmWasmClient.connectWithSigner;
    /**
     * Delay in milliseconds between submission retries when insufficient balance is detected.
     * @default 60000
     */
    insufficientBalanceRetryDelayMs?: number;
}

// =====================
// Contract Execute Messages
// Matches pyth contract msg.rs
// =====================

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
    #isRunning = false;
    #insufficientBalanceCooldownUntil: number | null = null;
    #lastPriceReceivedAt?: string;
    #lastPriceUpdateAt?: string;
    #logger: Exclude<HermesConfig["logger"], undefined>;
    #connectWithSigner: typeof SigningCosmWasmClient.connectWithSigner;
    #smartContractConfig: {
        expiresAt: number;
        value?: Promise<ConfigResponse>;
    } = { expiresAt: 0 };

    static async connect(config: HermesConfig): Promise<HermesClient> {
        const client = new HermesClient(config);
        await client.initialize();
        return client;
    }
    #priceUpdater?: PriceUpdater;

    constructor(config: HermesConfig) {
        const unsafeAllowInsecureEndpoints = config.unsafeAllowInsecureEndpoints ?? false;

        validateEndpointUrl(config.rpcEndpoint, "RPC endpoint", !unsafeAllowInsecureEndpoints);
        validateWalletSecret(config.walletSecret);
        validateContractAddress(config.contractAddress);

        this.#config = {
            ...config,
            denom: config.denom ?? "uakt",
            gasPrice: config.gasPrice ?? "0.025uakt",
            unsafeAllowInsecureEndpoints,
            priceDeviationTolerance: config.priceDeviationTolerance ?? DEFAULT_PRICE_DEVIATION_TOLERANCE,
            insufficientBalanceRetryDelayMs: config.insufficientBalanceRetryDelayMs ?? 60_000,
        };
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

            this.#logger.log("Fetching smart contract configuration...");
            const smartContractConfig = await this.queryConfig();
            this.#logger.log(`Using Pyth Price Feed ID: ${smartContractConfig.price_feed_id}`);
            this.#logger.log(`Update fee: ${smartContractConfig.update_fee} ${this.#config.denom}`);

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
        if (!this.#smartContractConfig.value || Date.now() > this.#smartContractConfig.expiresAt) {
            this.#smartContractConfig.expiresAt = Date.now() + this.#config.smartContractConfigCacheTTLMs;
            this.#smartContractConfig.value = this.#getCosmClient().queryContractSmart(
                this.#config.contractAddress,
                { get_config: {} },
            ).catch((error) => {
                this.#smartContractConfig.value = undefined;
                this.#smartContractConfig.expiresAt = 0;
                throw error;
            });
        }

        const config = await this.#smartContractConfig.value;

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

    async updatePrice(options?: {
        signal?: AbortSignal;
    }): Promise<void> {
        const smartCotractConfig = await this.queryConfig();
        const priceStream = this.#config.priceProducerFactory({
            priceFeedId: smartCotractConfig.price_feed_id,
            logger: this.#logger,
            signal: options?.signal,
        });
        const priceUpdate = await priceStream.next();

        if (priceUpdate.value) {
            await this.#updatePrice(priceUpdate.value);
            this.#logger.log("\nUpdate completed successfully!");
        } else {
            this.#logger.log("\nUpdate skipped because no new price was available.");
        }

        priceStream.return?.();
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
    async #updatePrice(priceUpdate: PriceUpdate): Promise<void> {
        if (!this.#senderAddress) {
            throw new Error("Client not initialized");
        }

        if (this.#insufficientBalanceCooldownUntil !== null) {
            if (Date.now() < this.#insufficientBalanceCooldownUntil) {
                this.#logger.warn("Skipping price update: insufficient balance cooldown active");
                return;
            }
            this.#logger.log("Insufficient balance cooldown expired, retrying...");
        }

        const startTime = performance.now();

        try {
            const currentPrice = await this.queryCurrentPrice();

            const staleness = priceUpdate.priceData.price.publish_time - currentPrice.publish_time;
            blockchainPriceStaleness.record(staleness);

            if (this.#canIgnorePriceUpdate(priceUpdate.priceData, currentPrice)) {
                priceUpdateCounter.add(1, { result: "skipped" });
                return;
            }

            const config = await this.queryConfig();

            this.#logger.log("Submitting VAA to Pyth contract...");
            this.#logger.log(`  Wormhole contract: ${config.wormhole_contract}`);
            this.#priceUpdater ??= new PriceUpdateConfirmed(this.#getCosmClient());
            const result = await this.#priceUpdater.updatePrice(priceUpdate, {
                senderAddress: this.#senderAddress,
                contractAddress: this.#config.contractAddress,
                denom: this.#config.denom,
                updateFee: config.update_fee,
            });

            const price = priceUpdate.priceData.price;
            this.#logger.log(`Price updated successfully! TX: ${result.transactionHash}`);
            if (result.gasUsed !== undefined) {
                this.#logger.log(`  Gas used: ${result.gasUsed}`);
            }
            this.#logger.log(`  New price: ${price.price} (expo: ${price.expo})`);
            priceUpdateCounter.add(1, { result: "success" });
            this.#lastPriceUpdateAt = new Date().toISOString();
            this.#insufficientBalanceCooldownUntil = null;
        } catch (error) {
            // SEC-04: Sanitize error messages to prevent information leakage
            const errorCode = classifyError(error);
            if (errorCode === "insufficient_balance") {
                this.#insufficientBalanceCooldownUntil = Date.now() + this.#config.insufficientBalanceRetryDelayMs;
                this.#logger.warn(`Entering insufficient balance cooldown for ${this.#config.insufficientBalanceRetryDelayMs}ms`);
            }
            const safeMessage = sanitizeErrorMessage(error, "Failed to update price");
            this.#logger.error(safeMessage);
            priceUpdateCounter.add(1, { result: "failure", error_code: errorCode });
            throw new Error(safeMessage);
        } finally {
            this.#logger.log(`Price updated in ${((performance.now() - startTime) / 1000).toFixed(2)} s`);
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

        if (options?.signal?.aborted) return;

        const controller = new AbortController();
        const signal = options?.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;

        // important to be set before any async operation to prevent multiple concurrent starts
        this.#isRunning = true;
        signal.addEventListener("abort", () => {
            this.#isRunning = false;
            this.#logger.log("Hermes client stopped");
        }, { once: true });

        try {
            this.#logger.log(
                "Starting automatic price consumption",
            );

            if (!this.#cosmClient) {
                await this.initialize();
            }

            const smartContractConfig = await this.queryConfig();
            const priceStream = this.#config.priceProducerFactory({
                priceFeedId: smartContractConfig.price_feed_id,
                signal,
                logger: this.#logger,
            });
            const priceUpdates = latestValue<PriceUpdate>({ signal });
            const consumePrices = async () => {
                for await (const priceUpdate of priceStream) {
                    priceUpdates.set(priceUpdate);

                    const price = priceUpdate.priceData.price;
                    this.#logger?.log(
                        `Received price from Hermes: ${price.price} (expo: ${price.expo})`,
                    );
                    this.#logger?.log(
                        `  Confidence: ${price.conf}, Publish time: ${price.publish_time}`,
                    );
                    this.#logger?.log(
                        `  VAA size: ${priceUpdate.vaa.length} bytes (base64)`,
                    );
                    this.#lastPriceReceivedAt = new Date().toISOString();
                }
                controller.abort();
            };
            const updatePrices = async () => {
                for await (const priceUpdate of priceUpdates) {
                    try {
                        await this.#updatePrice(priceUpdate);
                    } catch (error) {
                        this.#logger.error("Error in scheduled update:", error);
                    }
                }
            };

            await Promise.all([consumePrices(), updatePrices()]);
        } catch (error) {
            controller.abort();
            const safeMessage = sanitizeErrorMessage(error, "Failed to start Hermes client");
            this.#logger.error(safeMessage);
            throw new Error(safeMessage);
        } finally {
            this.#isRunning = false;
        }
    }

    /**
     * Get client status
     */
    async getStatus(): Promise<{
        isRunning: boolean;
        address?: string;
        priceFeedId?: string;
        contractAddress: string;
        lastPriceUpdateReceivedAt?: string;
        lastPriceUpdateAt?: string;
    }> {
        // SEC-08: Only return non-sensitive operational status fields.
        // Never include mnemonic, gasPrice, rpcEndpoint, or full config.
        const smartContractConfig = await this.queryConfig();

        return {
            isRunning: this.#isRunning,
            address: this.#senderAddress,
            priceFeedId: smartContractConfig.price_feed_id,
            contractAddress: this.#config.contractAddress,
            lastPriceUpdateReceivedAt: this.#lastPriceReceivedAt,
            lastPriceUpdateAt: this.#lastPriceUpdateAt,
        };
    }
}

export type {
    ConfigResponse, DataSourceResponse, OracleParamsResponse, PriceFeedIdResponse, PriceFeedResponse, PriceResponse, RefreshOracleParamsMsg, TransferAdminMsg, UpdateFeeMsg,
};

export type ErrorCode = "insufficient_balance" | "timeout" | "connection_issue" | "unknown";

export function classifyError(error: unknown): ErrorCode {
    const message = error instanceof Error ? error.message : "";

    if (/insufficient funds|insufficient fee/i.test(message)) {
        return "insufficient_balance";
    }
    if (/timeout|ETIMEDOUT/i.test(message)) {
        return "timeout";
    }
    if (/ECONNREFUSED|ECONNRESET|ENOTFOUND/i.test(message)) {
        return "connection_issue";
    }
    return "unknown";
}

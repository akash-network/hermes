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
import { DirectSecp256k1HdWallet } from "@cosmjs/proto-signing";
import { GasPrice } from "@cosmjs/stargate";
import axios from "axios";
import {
    validateEndpointUrl,
    validateAkashAddress,
    validateFeeAmount,
    safeParseInt,
    sanitizeErrorMessage,
    validateMnemonicFormat,
} from "./validation";

// Hermes API endpoint
const HERMES_API = "https://hermes.pyth.network";

// Price feed update interval (5 minutes)
const UPDATE_INTERVAL_MS = 5 * 60 * 1000;

// Configuration
interface HermesConfig {
    rpcEndpoint: string;
    contractAddress: string;
    mnemonic: string;
    hermesEndpoint?: string;
    updateIntervalMs?: number;
    denom?: string;
    gasPrice?: string;
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
interface HermesResponse {
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

export class HermesClient {
    private client?: SigningCosmWasmClient;
    private wallet?: DirectSecp256k1HdWallet;
    private senderAddress?: string;
    private config: Required<HermesConfig>;
    private priceFeedId?: string;
    private isRunning = false;
    private updateTimer?: NodeJS.Timeout;

    constructor(config: HermesConfig) {
        // SEC-02: Validate endpoint URLs to prevent SSRF
        validateEndpointUrl(config.rpcEndpoint, 'RPC endpoint');
        if (config.hermesEndpoint) {
            validateEndpointUrl(config.hermesEndpoint, 'Hermes endpoint');
        }

        // SEC-01: Validate mnemonic format without logging it
        validateMnemonicFormat(config.mnemonic);

        // SEC-03: Validate interval if provided
        const interval = config.updateIntervalMs ?? UPDATE_INTERVAL_MS;
        if (typeof interval !== 'number' || isNaN(interval) || !isFinite(interval) || interval <= 0) {
            throw new Error('Invalid update interval: must be a positive number');
        }

        this.config = {
            ...config,
            hermesEndpoint: config.hermesEndpoint || HERMES_API,
            updateIntervalMs: interval,
            denom: config.denom || "uakt",
            gasPrice: config.gasPrice || "0.025uakt",
        };
    }

    /**
     * Initialize the client and connect to the chain
     */
    async initialize(): Promise<void> {
        console.log("Initializing Hermes client...");

        // Create wallet from mnemonic
        this.wallet = await DirectSecp256k1HdWallet.fromMnemonic(
            this.config.mnemonic,
            { prefix: "akash" }
        );

        // Get sender address
        const [account] = await this.wallet.getAccounts();
        this.senderAddress = account.address;
        console.log(`Using address: ${this.senderAddress}`);

        // Connect to the chain
        this.client = await SigningCosmWasmClient.connectWithSigner(
            this.config.rpcEndpoint,
            this.wallet,
            {
                gasPrice: GasPrice.fromString(this.config.gasPrice),
            }
        );

        // Fetch price feed ID from contract
        await this.fetchPriceFeedId();

        console.log("Hermes client initialized successfully");
    }

    /**
     * Fetch the price feed ID from the contract
     */
    private async fetchPriceFeedId(): Promise<void> {
        if (!this.client) {
            throw new Error("Client not initialized");
        }

        const config: ConfigResponse = await this.client.queryContractSmart(
            this.config.contractAddress,
            { get_config: {} }
        );

        this.priceFeedId = config.price_feed_id;
        console.log(`Using Pyth Price Feed ID: ${this.priceFeedId}`);
        console.log(`Update fee: ${config.update_fee} ${this.config.denom}`);
    }

    /**
     * Fetch latest price data with VAA from Hermes
     * Returns both parsed price data (for logging) and raw VAA (for contract)
     */
    private async fetchPriceFromHermes(): Promise<{
        priceData: PythPriceData;
        vaa: string;
    }> {
        if (!this.priceFeedId) {
            throw new Error("Price feed ID not loaded");
        }

        try {
            // Request base64 encoding for VAA data (compatible with CosmWasm Binary)
            const response = await axios.get<HermesResponse>(
                `${this.config.hermesEndpoint}/v2/updates/price/latest`,
                {
                    params: {
                        ids: [this.priceFeedId],
                        encoding: "base64",  // Request base64 for CosmWasm Binary
                    },
                }
            );

            if (!response.data.parsed || response.data.parsed.length === 0) {
                throw new Error("No price data returned from Hermes");
            }

            if (!response.data.binary?.data || response.data.binary.data.length === 0) {
                throw new Error("No VAA binary data returned from Hermes");
            }

            const priceData: PythPriceData = response.data.parsed[0];
            const vaa: string = response.data.binary.data[0];

            console.log(
                `Fetched price from Hermes: ${priceData.price.price} (expo: ${priceData.price.expo})`
            );
            console.log(
                `  Confidence: ${priceData.price.conf}, Publish time: ${priceData.price.publish_time}`
            );
            console.log(
                `  VAA size: ${vaa.length} bytes (base64)`
            );

            return { priceData, vaa };
        } catch (error) {
            if (axios.isAxiosError(error)) {
                // SEC-04: Do not leak API response bodies or internal URLs
                const statusCode = error.response?.status;
                const statusText = statusCode ? ` (HTTP ${statusCode})` : '';
                throw new Error(
                    `Failed to fetch from Hermes${statusText}: price data unavailable`
                );
            }
            throw error;
        }
    }

    /**
     * Query current price from contract
     */
    async queryCurrentPrice(): Promise<PriceResponse> {
        if (!this.client) {
            throw new Error("Client not initialized");
        }

        const price: PriceResponse = await this.client.queryContractSmart(
            this.config.contractAddress,
            { get_price: {} }
        );

        return price;
    }

    /**
     * Query current price feed with metadata from contract
     */
    async queryPriceFeed(): Promise<PriceFeedResponse> {
        if (!this.client) {
            throw new Error("Client not initialized");
        }

        const feed: PriceFeedResponse = await this.client.queryContractSmart(
            this.config.contractAddress,
            { get_price_feed: {} }
        );

        return feed;
    }

    /**
     * Query contract configuration
     */
    async queryConfig(): Promise<ConfigResponse> {
        if (!this.client) {
            throw new Error("Client not initialized");
        }

        const config: ConfigResponse = await this.client.queryContractSmart(
            this.config.contractAddress,
            { get_config: {} }
        );

        return config;
    }

    /**
     * Query cached oracle parameters from contract
     */
    async queryOracleParams(): Promise<OracleParamsResponse> {
        if (!this.client) {
            throw new Error("Client not initialized");
        }

        const params: OracleParamsResponse = await this.client.queryContractSmart(
            this.config.contractAddress,
            { get_oracle_params: {} }
        );

        return params;
    }

    /**
     * Refresh cached oracle parameters (admin only)
     */
    async refreshOracleParams(): Promise<string> {
        if (!this.client || !this.senderAddress) {
            throw new Error("Client not initialized");
        }

        const msg: RefreshOracleParamsMsg = {
            refresh_oracle_params: {},
        };

        const result = await this.client.execute(
            this.senderAddress,
            this.config.contractAddress,
            msg,
            "auto"
        );

        return result.transactionHash;
    }

    /**
     * Update the update fee (admin only)
     */
    async updateFee(newFee: string): Promise<string> {
        // SEC-06: Validate fee format before any operation
        validateFeeAmount(newFee);

        if (!this.client || !this.senderAddress) {
            throw new Error("Client not initialized");
        }

        const msg: UpdateFeeMsg = {
            update_fee: {
                new_fee: newFee,
            },
        };

        const result = await this.client.execute(
            this.senderAddress,
            this.config.contractAddress,
            msg,
            "auto"
        );

        return result.transactionHash;
    }

    /**
     * Transfer admin rights (admin only)
     */
    async transferAdmin(newAdmin: string): Promise<string> {
        // SEC-05: Validate address format before any operation
        validateAkashAddress(newAdmin);

        if (!this.client || !this.senderAddress) {
            throw new Error("Client not initialized");
        }

        const msg: TransferAdminMsg = {
            transfer_admin: {
                new_admin: newAdmin,
            },
        };

        const result = await this.client.execute(
            this.senderAddress,
            this.config.contractAddress,
            msg,
            "auto"
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
        if (!this.client || !this.senderAddress) {
            throw new Error("Client not initialized");
        }

        try {
            // Fetch latest price + VAA from Hermes
            const { priceData, vaa } = await this.fetchPriceFromHermes();

            // Get current price from contract (for staleness check)
            const currentPrice = await this.queryCurrentPrice();

            // Check if update is needed (publish_time must be newer)
            if (priceData.price.publish_time <= currentPrice.publish_time) {
                console.log(
                    `Price already up to date (publish_time: ${currentPrice.publish_time})`
                );
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
            const config: ConfigResponse = await this.client.queryContractSmart(
                this.config.contractAddress,
                { get_config: {} }
            );

            // Execute update
            console.log("Submitting VAA to Pyth contract...");
            console.log(`  Wormhole contract: ${config.wormhole_contract}`);
            const result = await this.client.execute(
                this.senderAddress,
                this.config.contractAddress,
                msg,
                "auto",
                undefined,
                [{ denom: this.config.denom, amount: config.update_fee }]
            );

            console.log(`Price updated successfully! TX: ${result.transactionHash}`);
            console.log(`  Gas used: ${result.gasUsed}`);
            console.log(`  New price: ${priceData.price.price} (expo: ${priceData.price.expo})`);
        } catch (error) {
            // SEC-04: Sanitize error messages to prevent information leakage
            const safeMessage = sanitizeErrorMessage(error, 'Failed to update price');
            console.error(safeMessage);
            throw new Error(safeMessage);
        }
    }

    /**
     * Start automatic price updates
     */
    async start(): Promise<void> {
        if (this.isRunning) {
            console.log("Hermes client is already running");
            return;
        }

        if (!this.client) {
            await this.initialize();
        }

        this.isRunning = true;
        console.log(
            `Starting automatic updates every ${this.config.updateIntervalMs / 1000}s`
        );

        // Initial update
        await this.updatePrice();

        // Schedule periodic updates
        this.updateTimer = setInterval(async () => {
            try {
                await this.updatePrice();
            } catch (error) {
                console.error("Error in scheduled update:", error);
            }
        }, this.config.updateIntervalMs);
    }

    /**
     * Stop automatic price updates
     */
    stop(): void {
        if (this.updateTimer) {
            clearInterval(this.updateTimer);
            this.updateTimer = undefined;
        }
        this.isRunning = false;
        console.log("Hermes client stopped");
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
            isRunning: this.isRunning,
            address: this.senderAddress,
            priceFeedId: this.priceFeedId,
            contractAddress: this.config.contractAddress,
        };
    }
}

// CLI usage example
async function main() {
    if (!process.env.CONTRACT_ADDRESS) {
        console.error("CONTRACT_ADDRESS environment variable is required");
        process.exit(1);
    }

    if (!process.env.MNEMONIC) {
        console.error("MNEMONIC environment variable is required");
        process.exit(1);
    }

    // SEC-03: Use safe integer parsing with radix 10 and validation
    const updateInterval = safeParseInt(process.env.UPDATE_INTERVAL_MS, 'UPDATE_INTERVAL_MS');

    const config: HermesConfig = {
        rpcEndpoint: process.env.RPC_ENDPOINT || "https://rpc.akashnet.net:443",
        contractAddress: process.env.CONTRACT_ADDRESS,
        mnemonic: process.env.MNEMONIC,
        hermesEndpoint: process.env.HERMES_ENDPOINT,
        updateIntervalMs: updateInterval,
    };

    const client = new HermesClient(config);

    // Handle graceful shutdown
    process.on("SIGINT", () => {
        console.log("\nShutting down...");
        client.stop();
        process.exit(0);
    });

    // Start the client
    await client.start();
}

// Run if executed directly
if (require.main === module) {
    main().catch((error) => {
        // SEC-04: Do not leak stack traces or internal details on fatal errors
        if (error instanceof Error) {
            console.error(`Fatal error: ${error.message}`);
        } else {
            console.error("Fatal error: an unexpected error occurred");
        }
        process.exit(1);
    });
}

// Export types for external use
export type {
    HermesConfig,
    HermesResponse,
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

export default HermesClient;
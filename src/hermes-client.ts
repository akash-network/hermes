/**
 * Hermes Client for fetching Pyth price data
 *
 * This client fetches AKT/USD price data from Pyth's Hermes API
 * and submits it to the Akash oracle contract.
 */

import { SigningCosmWasmClient } from "@cosmjs/cosmwasm-stargate";
import { DirectSecp256k1HdWallet } from "@cosmjs/proto-signing";
import { GasPrice } from "@cosmjs/stargate";
import axios from "axios";

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

// =====================
// Contract Execute Messages
// Matches price-oracle contract msg.rs
// =====================

interface UpdatePriceFeedMsg {
    update_price_feed: {
        price: string;        // Uint128 serializes as string in JSON
        conf: string;         // Uint128 serializes as string in JSON
        expo: number;         // i32
        publish_time: number; // i64
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
// Matches price-oracle contract msg.rs
// =====================

interface ConfigResponse {
    admin: string;
    update_fee: string;       // Uint256 serializes as string
    price_feed_id: string;
    default_denom: string;
    default_base_denom: string;
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
        this.config = {
            ...config,
            hermesEndpoint: config.hermesEndpoint || HERMES_API,
            updateIntervalMs: config.updateIntervalMs || UPDATE_INTERVAL_MS,
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
     * Fetch latest price data from Hermes
     */
    private async fetchPriceFromHermes(): Promise<PythPriceData> {
        if (!this.priceFeedId) {
            throw new Error("Price feed ID not loaded");
        }

        try {
            const response = await axios.get(
                `${this.config.hermesEndpoint}/v2/updates/price/latest`,
                {
                    params: {
                        ids: [this.priceFeedId],
                        encoding: "hex",
                    },
                }
            );

            if (!response.data.parsed || response.data.parsed.length === 0) {
                throw new Error("No price data returned from Hermes");
            }

            const priceData: PythPriceData = response.data.parsed[0];

            console.log(
                `Fetched price from Hermes: ${priceData.price.price} (expo: ${priceData.price.expo})`
            );
            console.log(
                `  Confidence: ${priceData.price.conf}, Publish time: ${priceData.price.publish_time}`
            );

            return priceData;
        } catch (error) {
            if (axios.isAxiosError(error)) {
                throw new Error(
                    `Failed to fetch from Hermes: ${error.response?.data?.message || error.message}`
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
     */
    async updatePrice(): Promise<void> {
        if (!this.client || !this.senderAddress) {
            throw new Error("Client not initialized");
        }

        try {
            // Fetch latest price from Hermes
            const priceData = await this.fetchPriceFromHermes();

            // Get current price from contract
            const currentPrice = await this.queryCurrentPrice();

            // Check if update is needed (publish_time must be newer)
            if (priceData.price.publish_time <= currentPrice.publish_time) {
                console.log(
                    `Price already up to date (publish_time: ${currentPrice.publish_time})`
                );
                return;
            }

            // Prepare execute message
            const msg: UpdatePriceFeedMsg = {
                update_price_feed: {
                    price: priceData.price.price,
                    conf: priceData.price.conf,
                    expo: priceData.price.expo,
                    publish_time: priceData.price.publish_time,
                },
            };

            // Get config to determine update fee
            const config: ConfigResponse = await this.client.queryContractSmart(
                this.config.contractAddress,
                { get_config: {} }
            );

            // Execute update
            console.log("Submitting price update to contract...");
            const result = await this.client.execute(
                this.senderAddress,
                this.config.contractAddress,
                msg,
                "auto",
                undefined,
                [{ denom: this.config.denom, amount: config.update_fee }]
            );

            console.log(`✓ Price updated successfully! TX: ${result.transactionHash}`);
            console.log(`  Gas used: ${result.gasUsed}`);
        } catch (error) {
            if (error instanceof Error) {
                console.error(`✗ Failed to update price: ${error.message}`);
            } else {
                console.error("✗ Failed to update price:", error);
            }
            throw error;
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
    const config: HermesConfig = {
        rpcEndpoint: process.env.RPC_ENDPOINT || "https://rpc.akashnet.net:443",
        contractAddress: process.env.CONTRACT_ADDRESS || "",
        mnemonic: process.env.MNEMONIC || "",
        hermesEndpoint: process.env.HERMES_ENDPOINT,
        updateIntervalMs: process.env.UPDATE_INTERVAL_MS
            ? parseInt(process.env.UPDATE_INTERVAL_MS)
            : undefined,
    };

    if (!config.contractAddress) {
        console.error("CONTRACT_ADDRESS environment variable is required");
        process.exit(1);
    }

    if (!config.mnemonic) {
        console.error("MNEMONIC environment variable is required");
        process.exit(1);
    }

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
        console.error("Fatal error:", error);
        process.exit(1);
    });
}

// Export types for external use
export type {
    HermesConfig,
    PythPriceData,
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
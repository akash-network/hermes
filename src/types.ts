// Pyth price data from Hermes API
export interface PythPriceData {
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

export interface PriceUpdate {
    priceData: PythPriceData;
    vaa: string;
}

export type PriceProducerFactory = (options: PriceProducerFactoryOptions) => AsyncGenerator<PriceUpdate, void, unknown>;
export interface PriceProducerFactoryOptions {
    priceFeedId: string;
    signal?: AbortSignal;
    logger?: Logger;
}

export type Logger = Pick<Console, "log" | "error" | "warn">;

// Hermes API response with VAA binary data
export interface HermesResponse {
    binary: {
        // Base64 encoded VAA data array
        data: string[];
    };
    parsed: PythPriceData[];
}

export interface PriceUpdater {
    updatePrice: (priceUpdate: PriceUpdate, options: PriceUpdateOptions) => Promise<{
        transactionHash: string;
        gasUsed?: bigint;
    }>;
}

export interface PriceUpdateOptions {
    senderAddress: string;
    contractAddress: string;
    denom: string;
    updateFee: string;
}

export interface UpdatePriceFeedMsg {
    update_price_feed: {
        // VAA data from Pyth Hermes API (base64 encoded Binary)
        // The Pyth contract will:
        // 1. Verify VAA via Wormhole contract
        // 2. Parse Pyth price attestation from payload
        // 3. Relay to x/oracle module
        vaa: string;
    };
}

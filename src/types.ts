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

import { metrics } from "@opentelemetry/api";

const meter = metrics.getMeter("hermes-client");
export const priceUpdateCounter = meter.createCounter("hermes.price_update", {
    description: "Number of price update attempts",
});
export const hermesFetchDuration = meter.createHistogram("hermes.price_fetch_duration", {
    description: "Duration of Hermes API price fetch in milliseconds",
    unit: "ms",
});
export const priceStaleness = meter.createGauge("hermes.price_staleness", {
    description: "How far behind the on-chain price is from the latest Pyth price",
    unit: "s",
});

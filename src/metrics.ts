import { metrics } from "@opentelemetry/api";

const meter = metrics.getMeter("hermes-client");
export const priceUpdateCounter = meter.createCounter("hermes.price_update", {
    description: "Number of price update attempts",
});
export const hermesFetchDuration = meter.createHistogram("hermes.price_fetch_duration", {
    description: "Duration of Hermes API price fetch in milliseconds",
    unit: "ms",
});

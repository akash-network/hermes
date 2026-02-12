import { PrometheusExporter } from "@opentelemetry/exporter-prometheus";

export const prometheusExporter = new PrometheusExporter({
    preventServerStart: true,
});

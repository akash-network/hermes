import process from "node:process";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { RuntimeNodeInstrumentation } from "@opentelemetry/instrumentation-runtime-node";
import { processDetector, envDetector, hostDetector } from "@opentelemetry/resources";
import { containerDetector } from "@opentelemetry/resource-detector-container";
import { prometheusExporter } from "./instrumentation/prometheus-exporter.ts";

const sdk = new NodeSDK({
    metricReader: prometheusExporter,
    instrumentations: [
        new RuntimeNodeInstrumentation({
            monitoringPrecision: 5000,
        }),
    ],
    resourceDetectors: [
        containerDetector,
        processDetector,
        envDetector,
        hostDetector,
    ],
});

sdk.start();

const shutdown = () => sdk.shutdown();
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

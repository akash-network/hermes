import http from "node:http";
import type { AddressInfo } from "node:net";
import { prometheusExporter } from "../instrumentation/prometheus-exporter.ts";
import type { CommandConfig } from "./command-config.ts";

export async function daemonCommand(config: CommandConfig): Promise<void> {
    if (config.signal.aborted) return;

    config.logger?.log("Starting daemon mode...\n");

    const client = await config.createHermesClient(config);
    const server = http.createServer((req, res) => {
        if (req.method === "GET" && req.url === "/health") {
            client.getStatus()
                .then((status) => {
                    res.writeHead(200, { "Content-Type": "application/json" });
                    res.end(JSON.stringify(status));
                })
                .catch((error) => {
                    config.logger?.log(`Error fetching health status: ${error.message}`);
                    res.writeHead(500, { "Content-Type": "application/json" });
                    res.end();
                });
        } else if (req.method === "GET" && req.url === "/metrics") {
            prometheusExporter.getMetricsRequestHandler(req, res);
        } else {
            res.writeHead(404, { "Content-Type": "text/plain" });
            res.end("Not Found");
        }
    });
    const abort = () => {
        config.logger?.log("\n\nShutting down daemon...");
        config.logger?.log("\nStopping health check server...");
    };
    config.signal.addEventListener("abort", abort, { once: true });
    await Promise.all([
        client.start({ signal: config.signal }),
        new Promise<void>((resolve, reject) => {
            server.once("error", reject);
            server.listen({ port: config.healthcheckPort, signal: config.signal }, () => {
                config.logger?.log(`Health check endpoint available at http://localhost:${(server.address() as AddressInfo).port}/health`);
                server.off("error", reject);
                server.once("close", resolve);
            });
        }),
    ]);
    config.signal.removeEventListener("abort", abort);
}

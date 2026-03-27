import http from "node:http";
import https from "node:https";
import { performance } from "node:perf_hooks";
import { Readable } from "node:stream";
import { setTimeout as delay } from "node:timers/promises";
import { hermesFetchDuration } from "../metrics.ts";
import type { HermesResponse, PriceProducerFactoryOptions, PriceUpdate, PythPriceData } from "../types.ts";
import { validateEndpointUrl } from "../validation.ts";

export async function *pollPriceStream(options: PollPriceStreamOptions): AsyncGenerator<PriceUpdate> {
    if (!options.priceFeedId) {
        throw new Error("Price feed ID not provided to PollPriceStream");
    }

    validateEndpointUrl(options.baseUrl, "Hermes endpoint", !options.unsafeAllowInsecureEndpoints);

    // Request base64 encoding for VAA data (compatible with CosmWasm Binary)
    const params = new URLSearchParams({
        "ids[]": options.priceFeedId,
        encoding: "base64",
    });
    const fetch = options.fetch ?? createFetch();

    let response: Response | undefined;
    let status = 0;
    while (!options.signal?.aborted) {
        const fetchStart = performance.now();
        response = undefined;
        try {
            response = await fetch(`${options.baseUrl}/v2/updates/price/latest?${params.toString()}`);
            status = response.status;
        } catch (error) {
            if (error instanceof Error && (error.name === "AbortError" || error.message === "AbortError")) {
                break;
            }
            options.logger?.error(`Error fetching from Hermes: ${(error as Error).message}`);
            continue;
        } finally {
            hermesFetchDuration.record(performance.now() - fetchStart, { status });
            console.log(`Fetch from Hermes completed with status ${status} in ${performance.now() - fetchStart} ms`);
        }

        if (!response.ok) {
            const statusText = response.status ? ` (HTTP ${response.status})` : "";
            options.logger?.error(
                `Failed to fetch from Hermes${statusText}: price data unavailable`,
            );
            continue;
        }

        const data = await response.json() as HermesResponse;

        if (!data.parsed || data.parsed.length === 0) {
            options.logger?.error("No price data returned from Hermes");
            continue;
        }

        if (!data.binary?.data || data.binary.data.length === 0) {
            options.logger?.error("No VAA binary data returned from Hermes");
            continue;
        }

        const priceData: PythPriceData = data.parsed[0];
        const vaa: string = data.binary.data[0];

        options.logger?.log(
            `Fetched price from Hermes: ${priceData.price.price} (expo: ${priceData.price.expo})`,
        );
        options.logger?.log(
            `  Confidence: ${priceData.price.conf}, Publish time: ${priceData.price.publish_time}`,
        );
        options.logger?.log(
            `  VAA size: ${vaa.length} bytes (base64)`,
        );

        yield { priceData, vaa };
        if (options.pollingIntervalMs > 0) {
            await delay(options.pollingIntervalMs, undefined, { signal: options.signal })
                .catch((error) => options.logger?.warn(`Polling delay interrupted: ${(error as Error).message}`));
        }
    }
}

export interface PollPriceStreamOptions extends PriceProducerFactoryOptions {
    baseUrl: string;
    pollingIntervalMs: number;
    unsafeAllowInsecureEndpoints?: boolean;
    fetch?: typeof globalThis.fetch;
}

function createFetch() {
    // Agent is created to enable TLS session resumption
    const agent = new https.Agent({ keepAlive: true });

    return function fetch(url: string, options?: RequestInit): Promise<Response> {
        return new Promise((resolve, reject) => {
            if (options?.signal?.aborted) {
                reject(createAbortError());
                return;
            }

            const parsed = new URL(url);
            const isHttps = parsed.protocol === "https:";
            const mod = isHttps ? https : http;
            const requestOptions: https.RequestOptions = {
                method: "GET",
                hostname: parsed.hostname,
                port: parsed.port || (isHttps ? 443 : 80),
                path: `${parsed.pathname}${parsed.search}`,
                headers: {
                    accept: "application/json",
                },
                agent: isHttps ? agent : undefined,
            };

            const req = mod.request(requestOptions, (res: http.IncomingMessage) => {
                options?.signal?.removeEventListener("abort", destroyRequest);
                resolve(new Response(Readable.toWeb(res) as ReadableStream, {
                    status: res.statusCode ?? 0,
                    statusText: res.statusMessage ?? "",
                    headers: res.headers as Record<string, string>,
                }));
            });
            const destroyRequest = () => {
                req.destroy();
                reject(createAbortError());
            };
            options?.signal?.addEventListener("abort", destroyRequest, { once: true });

            req.on("error", reject);
            req.end();
        });
    };
}

function createAbortError() {
    const error = new Error("AbortError");
    error.name = "AbortError";
    return error;
}

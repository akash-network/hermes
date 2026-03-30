import { events } from "fetch-event-stream";
import { setTimeout } from "timers/promises";
import type { HermesResponse, PriceProducerFactoryOptions, PriceUpdate } from "../../types.ts";
import { validateEndpointUrl } from "../../validation.ts";
import { parsePriceUpdate } from "../utils.ts";

export async function *priceSSEStream(options: PriceSSEStreamOptions): AsyncGenerator<PriceUpdate> {
    if (!options.priceFeedId) {
        throw new Error("Price feed ID not provided to PriceSSEStream");
    }

    validateEndpointUrl(options.baseUrl, "Hermes endpoint", !options.unsafeAllowInsecureEndpoints);

    // Request base64 encoding for VAA data (compatible with CosmWasm Binary)
    const params = new URLSearchParams({
        "ids[]": options.priceFeedId,
        encoding: "base64",
    });
    const fetch = options.fetch ?? globalThis.fetch;
    const delay = options.delay ?? setTimeout;
    const parseEvents = options.events ?? events;
    const maxRetries = 3;
    let retryDelayMs = 2000;
    let retryCount = 0;
    let lastEventId: string | number | undefined = undefined;
    while (!options.signal?.aborted) {
        try {
            const headers: Record<string, string> = {};
            if (lastEventId) {
                headers["Last-Event-ID"] = String(lastEventId);
            }

            options.logger?.log(`Connecting to Hermes price stream at ${options.baseUrl}${lastEventId ? ` (Last-Event-ID: ${lastEventId})` : ""}...`);
            const response = await fetch(`${options.baseUrl}/v2/updates/price/stream?${params.toString()}`, {
                headers,
                signal: options.signal,
            });
            if (!response.ok) {
                const statusText = response.status ? ` (HTTP ${response.status})` : "";
                throw new Error(
                    `Failed to connect to Hermes price stream${statusText}: price data unavailable`,
                );
            }

            retryCount = 0;
            const stream = parseEvents(response, options.signal);
            for await (const event of stream) {
                if (event.id !== undefined) {
                    lastEventId = event.id;
                }

                if (event.retry !== undefined) {
                    retryDelayMs = event.retry;
                    options.logger?.log(`Received retry directive from Hermes stream: ${retryDelayMs} ms`);
                }

                if (!event.data) continue;

                let parsedData: HermesResponse;
                try {
                    parsedData = JSON.parse(event.data);
                } catch (error) {
                    options.logger?.error(`Error parsing JSON from Hermes stream: ${(error as Error).message}`);
                    continue;
                }

                const priceUpdateResult = parsePriceUpdate(parsedData);
                if (!priceUpdateResult.ok) {
                    options.logger?.error(priceUpdateResult.message);
                    continue;
                }

                yield priceUpdateResult.value;
            }
        } catch (error) {
            if (error instanceof Error && error.name === "AbortError") {
                break;
            }
            options.logger?.error(`Error connecting to Hermes price stream: ${(error as Error).message}`);
            if (++retryCount > maxRetries) {
                options.logger?.error(`Exceeded maximum retry attempts (${maxRetries}) for connecting to Hermes price stream`);
                throw new Error(`Unable to connect to Hermes price stream after ${maxRetries} attempts`);
            }
            options.logger?.log(`Retrying connection to Hermes price stream (attempt ${retryCount}/${maxRetries})...`);
            await delay(retryDelayMs, undefined, { signal: options.signal })
                .catch((error) => options.logger?.warn(`Retry delay interrupted: ${(error as Error).message}`));
        }
    }
}

export interface PriceSSEStreamOptions extends PriceProducerFactoryOptions {
    baseUrl: string;
    unsafeAllowInsecureEndpoints?: boolean;
    fetch?: typeof globalThis.fetch;
    delay?: typeof setTimeout;
    events?: typeof events;
}

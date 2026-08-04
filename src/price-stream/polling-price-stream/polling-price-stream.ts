import http from "node:http";
import https from "node:https";
import { performance } from "node:perf_hooks";
import { Readable } from "node:stream";
import { setTimeout as delay } from "node:timers/promises";
import { hermesFetchDuration } from "../../metrics.ts";
import type { HermesResponse, PriceProducerFactoryOptions, PriceUpdate } from "../../types.ts";
import { validateEndpointUrl } from "../../validation.ts";
import { parsePriceUpdate } from "../utils.ts";

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
  const sleep = options.delay ?? delay;
  const retryBaseDelayMs = options.retryBaseDelayMs ?? DEFAULT_RETRY_BASE_DELAY_MS;
  const retryMaxDelayMs = options.retryMaxDelayMs ?? DEFAULT_RETRY_MAX_DELAY_MS;
  const headers: Record<string, string> = {};

  if (options.authenticationToken) {
    headers["Authorization"] = `Bearer ${options.authenticationToken}`;
  }

  const url = `${options.baseUrl}/v2/updates/price/latest?${params.toString()}`;

  // Fetches a single price update, mapping every failure mode onto a result so the
  // polling loop below can decide between backing off and stopping.
  const fetchPriceUpdate = async (): Promise<FetchAttempt> => {
    const fetchStart = performance.now();
    let response: Response;
    let status = 0;
    try {
      const timeoutSignal = AbortSignal.timeout(10_000);
      response = await fetch(url, {
        signal: options.signal ? AbortSignal.any([options.signal, timeoutSignal]) : timeoutSignal,
        headers,
      });
      status = response.status;
    } catch (error) {
      if (error instanceof Error && (error.name === "AbortError" || error.message === "AbortError")) {
        return { status: "aborted" };
      }
      return { status: "failed", message: `Error fetching from Hermes: ${(error as Error).message}` };
    } finally {
      hermesFetchDuration.record(performance.now() - fetchStart, { status });
    }

    if (!response.ok) {
      const statusText = response.status ? ` (HTTP ${response.status})` : "";
      return {
        status: "failed",
        message: `Failed to fetch from Hermes${statusText}: price data unavailable`,
      };
    }

    let parsedData: HermesResponse;
    try {
      parsedData = await response.json() as HermesResponse;
    } catch (error) {
      return { status: "failed", message: `Error parsing JSON from Hermes: ${(error as Error).message}` };
    }

    const priceUpdateResult = parsePriceUpdate(parsedData);

    if (!priceUpdateResult.ok) {
      return { status: "failed", message: priceUpdateResult.message };
    }

    return { status: "ok", value: priceUpdateResult.value };
  };

  let consecutiveFailures = 0;
  while (!options.signal?.aborted) {
    const attempt = await fetchPriceUpdate();

    if (attempt.status === "aborted") {
      break;
    }

    if (attempt.status === "failed") {
      options.logger?.error(attempt.message);
      const backoffMs = Math.min(retryBaseDelayMs * 2 ** consecutiveFailures, retryMaxDelayMs);
      consecutiveFailures++;
      options.logger?.warn(`Retrying fetch from Hermes in ${backoffMs} ms (attempt ${consecutiveFailures})`);
      await sleep(backoffMs, undefined, { signal: options.signal })
        .catch((error) => options.logger?.warn(`Retry delay interrupted: ${(error as Error).message}`));
      continue;
    }

    consecutiveFailures = 0;
    yield attempt.value;
    if (options.pollingIntervalMs > 0) {
      await sleep(options.pollingIntervalMs, undefined, { signal: options.signal })
        .catch((error) => options.logger?.warn(`Polling delay interrupted: ${(error as Error).message}`));
    }
  }
}

const DEFAULT_RETRY_BASE_DELAY_MS = 500;
const DEFAULT_RETRY_MAX_DELAY_MS = 5_000;

type FetchAttempt =
  | { status: "ok"; value: PriceUpdate }
  | { status: "aborted" }
  | { status: "failed"; message: string };

export interface PollPriceStreamOptions extends PriceProducerFactoryOptions {
  baseUrl: string;
  authenticationToken?: string;
  pollingIntervalMs: number;
  /** First retry delay after a failed poll; doubles on each consecutive failure. Defaults to 500 ms. */
  retryBaseDelayMs?: number;
  /** Upper bound for the exponential retry delay. Defaults to 5000 ms. */
  retryMaxDelayMs?: number;
  unsafeAllowInsecureEndpoints?: boolean;
  fetch?: typeof globalThis.fetch;
  delay?: typeof delay;
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
      const headers = new Headers(options?.headers);
      headers.set("accept", "application/json");
      const requestOptions: https.RequestOptions = {
        method: "GET",
        hostname: parsed.hostname,
        port: parsed.port || (isHttps ? 443 : 80),
        path: `${parsed.pathname}${parsed.search}`,
        headers: Object.fromEntries(headers.entries()),
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

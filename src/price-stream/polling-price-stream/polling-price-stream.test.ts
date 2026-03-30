import { describe, expect, it, vi } from "vitest";
import type { HermesResponse } from "../../types.ts";
import { pollPriceStream, type PollPriceStreamOptions } from "./polling-price-stream.ts";

describe("pollPriceStream", () => {
    it("throws when priceFeedId is not provided", async () => {
        const options = createOptions({ priceFeedId: "" });
        const gen = pollPriceStream(options);

        await expect(gen.next()).rejects.toThrow("Price feed ID not provided");
    });

    it("throws when baseUrl is invalid", async () => {
        const options = createOptions({ baseUrl: "not-a-url", unsafeAllowInsecureEndpoints: false });
        const gen = pollPriceStream(options);

        await expect(gen.next()).rejects.toThrow("not a valid URL");
    });

    it("throws when baseUrl is not HTTPS and insecure endpoints are not allowed", async () => {
        const options = createOptions({ baseUrl: "http://example.com", unsafeAllowInsecureEndpoints: false });
        const gen = pollPriceStream(options);

        await expect(gen.next()).rejects.toThrow("only HTTPS endpoints are allowed");
    });

    it("yields price update on successful response", async () => {
        const data = createHermesResponse();
        const options = createOptions({
            fetch: vi.fn().mockResolvedValueOnce(mockFetchResponse(data)),
        });

        const gen = pollPriceStream(options);
        const result = await gen.next();

        expect(result.value).toEqual({
            priceData: data.parsed[0],
            vaa: data.binary.data[0],
        });
    });

    it("constructs the correct URL with query params", async () => {
        const data = createHermesResponse();
        const fetchMock = vi.fn().mockResolvedValueOnce(mockFetchResponse(data));
        const options = createOptions({ fetch: fetchMock, priceFeedId: "feed-xyz" });

        const gen = pollPriceStream(options);
        await gen.next();

        const calledUrl = fetchMock.mock.calls[0][0] as string;
        expect(calledUrl).toContain("/v2/updates/price/latest?");
        expect(calledUrl).toContain("ids%5B%5D=feed-xyz");
        expect(calledUrl).toContain("encoding=base64");
    });

    it("logs error and retries on non-ok response", async () => {
        const logger = { log: vi.fn(), error: vi.fn(), warn: vi.fn() };
        const data = createHermesResponse();
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(mockFetchResponse(data, 500))
            .mockResolvedValueOnce(mockFetchResponse(data));

        const options = createOptions({ fetch: fetchMock, logger });
        const gen = pollPriceStream(options);
        const result = await gen.next();

        expect(logger.error).toHaveBeenCalledWith(
            expect.stringContaining("Failed to fetch from Hermes"),
        );
        expect(logger.error).toHaveBeenCalledWith(
            expect.stringContaining("HTTP 500"),
        );
        expect(result.value).toEqual({
            priceData: data.parsed[0],
            vaa: data.binary.data[0],
        });
    });

    it("logs error and retries when parsed data is empty", async () => {
        const logger = { log: vi.fn(), error: vi.fn(), warn: vi.fn() };
        const goodData = createHermesResponse();
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(mockFetchResponse(createHermesResponse({ parsed: [] })))
            .mockResolvedValueOnce(mockFetchResponse(goodData));

        const options = createOptions({ fetch: fetchMock, logger });
        const gen = pollPriceStream(options);
        const result = await gen.next();

        expect(logger.error).toHaveBeenCalledWith("No price data returned from Hermes");
        expect(result.value).toEqual({ priceData: goodData.parsed[0], vaa: goodData.binary.data[0] });
    });

    it("logs error and retries when binary data is empty", async () => {
        const logger = { log: vi.fn(), error: vi.fn(), warn: vi.fn() };
        const goodData = createHermesResponse();
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(mockFetchResponse(createHermesResponse({ binary: { data: [] } })))
            .mockResolvedValueOnce(mockFetchResponse(goodData));

        const options = createOptions({ fetch: fetchMock, logger });
        const gen = pollPriceStream(options);
        const result = await gen.next();

        expect(logger.error).toHaveBeenCalledWith("No VAA binary data returned from Hermes");
        expect(result.value).toEqual({ priceData: goodData.parsed[0], vaa: goodData.binary.data[0] });
    });

    it("polls repeatedly yielding updates", async () => {
        const data1 = createHermesResponse();
        const data2 = createHermesResponse({
            parsed: [{
                id: "abc123",
                price: { price: "2000", conf: "20", expo: -8, publish_time: 1700000001 },
                ema_price: { price: "1999", conf: "21", expo: -8, publish_time: 1700000001 },
            }],
            binary: { data: ["BAUG"] },
        });

        const fetchMock = vi.fn()
            .mockResolvedValueOnce(mockFetchResponse(data1))
            .mockResolvedValueOnce(mockFetchResponse(data2));

        const options = createOptions({ fetch: fetchMock, pollingIntervalMs: 10 });
        const gen = pollPriceStream(options);

        const first = await gen.next();
        const second = await gen.next();

        expect(first.value).toEqual({ priceData: data1.parsed[0], vaa: data1.binary.data[0] });
        expect(second.value).toEqual({ priceData: data2.parsed[0], vaa: data2.binary.data[0] });
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("stops when signal is aborted during polling delay", async () => {
        const controller = new AbortController();
        const data = createHermesResponse();
        const fetchMock = vi.fn().mockResolvedValue(mockFetchResponse(data));
        const options = createOptions({
            fetch: fetchMock,
            pollingIntervalMs: 60_000,
            signal: controller.signal,
        });

        const gen = pollPriceStream(options);
        const first = await gen.next();
        expect(first.done).toBe(false);

        // Abort after gen.next() resumes and enters the delay
        const secondPromise = gen.next();
        controller.abort();

        const second = await secondPromise;
        expect(second.done).toBe(true);
        expect(second.value).toBeUndefined();
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("stops immediately when signal is already aborted", async () => {
        const fetchMock = vi.fn();
        const options = createOptions({
            fetch: fetchMock,
            signal: AbortSignal.abort(),
        });

        const gen = pollPriceStream(options);
        const result = await gen.next();

        expect(result.done).toBe(true);
        expect(result.value).toBeUndefined();
        expect(fetchMock).not.toHaveBeenCalled();
    });
});

function createHermesResponse(overrides?: Partial<HermesResponse>): HermesResponse {
    return {
        parsed: [{
            id: "abc123",
            price: { price: "1000", conf: "10", expo: -8, publish_time: 1700000000 },
            ema_price: { price: "999", conf: "11", expo: -8, publish_time: 1700000000 },
        }],
        binary: { data: ["AQID"] },
        ...overrides,
    };
}

function createOptions(overrides?: Partial<PollPriceStreamOptions>): PollPriceStreamOptions {
    return {
        priceFeedId: "abc123",
        baseUrl: "http://localhost:4000",
        pollingIntervalMs: 100,
        unsafeAllowInsecureEndpoints: true,
        fetch: vi.fn(),
        ...overrides,
    };
}

function mockFetchResponse(data: HermesResponse, status = 200): Response {
    return {
        ok: status >= 200 && status < 300,
        status,
        json: () => Promise.resolve(data),
    } as unknown as Response;
}

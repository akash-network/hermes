import { describe, expect, it, vi } from "vitest";
import type { HermesResponse } from "../../types.ts";
import { priceSSEStream, type PriceSSEStreamOptions } from "./price-sse-stream.ts";

describe(priceSSEStream.name, () => {
    it("throws when priceFeedId is not provided", async () => {
        const options = createOptions({ priceFeedId: "" });
        const gen = priceSSEStream(options);

        await expect(gen.next()).rejects.toThrow("Price feed ID not provided");
    });

    it("throws when baseUrl is invalid", async () => {
        const options = createOptions({ baseUrl: "not-a-url", unsafeAllowInsecureEndpoints: false });
        const gen = priceSSEStream(options);

        await expect(gen.next()).rejects.toThrow("not a valid URL");
    });

    it("throws when baseUrl is not HTTPS and insecure endpoints are not allowed", async () => {
        const options = createOptions({ baseUrl: "http://example.com", unsafeAllowInsecureEndpoints: false });
        const gen = priceSSEStream(options);

        await expect(gen.next()).rejects.toThrow("only HTTPS endpoints are allowed");
    });

    it("yields price update on successful SSE event", async () => {
        const data = createHermesResponse();
        const options = createOptions({
            fetch: vi.fn().mockResolvedValueOnce(mockFetchResponse()),
            events: mockEvents([
                { data: JSON.stringify(data), id: "1" },
            ]),
        });

        const gen = priceSSEStream(options);
        const result = await gen.next();

        expect(result.value).toEqual({
            priceData: data.parsed[0],
            vaa: data.binary.data[0],
        });
    });

    it("constructs the correct URL with query params", async () => {
        const fetchMock = vi.fn().mockResolvedValueOnce(mockFetchResponse());
        const options = createOptions({
            fetch: fetchMock,
            priceFeedId: "feed-xyz",
            events: mockEvents([
                { data: JSON.stringify(createHermesResponse()), id: "1" },
            ]),
        });

        const gen = priceSSEStream(options);
        await gen.next();

        const calledUrl = fetchMock.mock.calls[0][0] as string;
        expect(calledUrl).toContain("/v2/updates/price/stream?");
        expect(calledUrl).toContain("ids%5B%5D=feed-xyz");
        expect(calledUrl).toContain("encoding=base64");
    });

    it("passes signal to fetch", async () => {
        const controller = new AbortController();
        const fetchMock = vi.fn().mockResolvedValueOnce(mockFetchResponse());
        const options = createOptions({
            fetch: fetchMock,
            signal: controller.signal,
            events: mockEvents([
                { data: JSON.stringify(createHermesResponse()), id: "1" },
            ]),
        });

        const gen = priceSSEStream(options);
        await gen.next();

        const fetchOptions = fetchMock.mock.calls[0][1] as { signal: AbortSignal };
        expect(fetchOptions.signal).toBeInstanceOf(AbortSignal);
        expect(fetchOptions.signal.aborted).toBe(false);
    });

    it("throws on non-ok HTTP response after max retries", async () => {
        const fetchMock = vi.fn().mockResolvedValue(mockFetchResponse(500));
        const options = createOptions({ fetch: fetchMock });

        const gen = priceSSEStream(options);
        await expect(gen.next()).rejects.toThrow("Unable to connect to Hermes price stream after 3 attempts");
        expect(fetchMock).toHaveBeenCalledTimes(4); // 1 initial + 3 retries
    });

    it("logs error on non-ok HTTP response", async () => {
        const logger = createLogger();
        const data = createHermesResponse();
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(mockFetchResponse(500))
            .mockResolvedValueOnce(mockFetchResponse());
        const options = createOptions({
            fetch: fetchMock,
            logger,
            events: mockEvents([
                { data: JSON.stringify(data), id: "1" },
            ]),
        });

        const gen = priceSSEStream(options);
        await gen.next();

        expect(logger.error).toHaveBeenCalledWith(
            expect.stringContaining("HTTP 500"),
        );
    });

    it("retries and recovers after fetch failure", async () => {
        const data = createHermesResponse();
        const fetchMock = vi.fn()
            .mockRejectedValueOnce(new Error("network error"))
            .mockResolvedValueOnce(mockFetchResponse());
        const options = createOptions({
            fetch: fetchMock,
            events: mockEvents([
                { data: JSON.stringify(data), id: "1" },
            ]),
        });

        const gen = priceSSEStream(options);
        const result = await gen.next();

        expect(result.value).toEqual({
            priceData: data.parsed[0],
            vaa: data.binary.data[0],
        });
    });

    it("skips events without data", async () => {
        const data = createHermesResponse();
        const options = createOptions({
            fetch: vi.fn().mockResolvedValueOnce(mockFetchResponse()),
            events: mockEvents([
                { id: "1" },
                { data: "", id: "2" },
                { data: JSON.stringify(data), id: "3" },
            ]),
        });

        const gen = priceSSEStream(options);
        const result = await gen.next();

        expect(result.value).toEqual({
            priceData: data.parsed[0],
            vaa: data.binary.data[0],
        });
    });

    it("skips events with invalid JSON and logs error", async () => {
        const logger = createLogger();
        const data = createHermesResponse();
        const options = createOptions({
            fetch: vi.fn().mockResolvedValueOnce(mockFetchResponse()),
            logger,
            events: mockEvents([
                { data: "not-json", id: "1" },
                { data: JSON.stringify(data), id: "2" },
            ]),
        });

        const gen = priceSSEStream(options);
        const result = await gen.next();

        expect(logger.error).toHaveBeenCalledWith(
            expect.stringContaining("Error parsing JSON"),
        );
        expect(result.value).toEqual({
            priceData: data.parsed[0],
            vaa: data.binary.data[0],
        });
    });

    it("skips events with empty parsed data and logs error", async () => {
        const logger = createLogger();
        const goodData = createHermesResponse();
        const options = createOptions({
            fetch: vi.fn().mockResolvedValueOnce(mockFetchResponse()),
            logger,
            events: mockEvents([
                { data: JSON.stringify(createHermesResponse({ parsed: [] })), id: "1" },
                { data: JSON.stringify(goodData), id: "2" },
            ]),
        });

        const gen = priceSSEStream(options);
        const result = await gen.next();

        expect(logger.error).toHaveBeenCalledWith("No price data returned from Hermes");
        expect(result.value).toEqual({ priceData: goodData.parsed[0], vaa: goodData.binary.data[0] });
    });

    it("skips events with empty binary data and logs error", async () => {
        const logger = createLogger();
        const goodData = createHermesResponse();
        const options = createOptions({
            fetch: vi.fn().mockResolvedValueOnce(mockFetchResponse()),
            logger,
            events: mockEvents([
                { data: JSON.stringify(createHermesResponse({ binary: { data: [] } })), id: "1" },
                { data: JSON.stringify(goodData), id: "2" },
            ]),
        });

        const gen = priceSSEStream(options);
        const result = await gen.next();

        expect(logger.error).toHaveBeenCalledWith("No VAA binary data returned from Hermes");
        expect(result.value).toEqual({ priceData: goodData.parsed[0], vaa: goodData.binary.data[0] });
    });

    it("sends Last-Event-ID header on reconnect", async () => {
        const data = createHermesResponse();
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(mockFetchResponse())
            .mockResolvedValueOnce(mockFetchResponse());
        const eventsFn = vi.fn()
            .mockReturnValueOnce(toAsyncGenerator([
                { data: JSON.stringify(data), id: "42" },
            ]))
            .mockReturnValueOnce(toAsyncGenerator([
                { data: JSON.stringify(data), id: "43" },
            ]));
        const options = createOptions({ fetch: fetchMock, events: eventsFn });

        const gen = priceSSEStream(options);
        await gen.next();
        await gen.next();

        const secondCallHeaders = fetchMock.mock.calls[1][1]?.headers as Record<string, string>;
        expect(secondCallHeaders["Last-Event-ID"]).toBe("42");
    });

    it("does not send Last-Event-ID header on first connection", async () => {
        const data = createHermesResponse();
        const fetchMock = vi.fn().mockResolvedValueOnce(mockFetchResponse());
        const options = createOptions({
            fetch: fetchMock,
            events: mockEvents([
                { data: JSON.stringify(data), id: "1" },
            ]),
        });

        const gen = priceSSEStream(options);
        await gen.next();

        const firstCallHeaders = fetchMock.mock.calls[0][1]?.headers as Record<string, string>;
        expect(firstCallHeaders["Last-Event-ID"]).toBeUndefined();
    });

    it("updates retry delay when event contains retry directive", async () => {
        const logger = createLogger();
        const data = createHermesResponse();
        const options = createOptions({
            fetch: vi.fn().mockResolvedValueOnce(mockFetchResponse()),
            logger,
            events: mockEvents([
                { data: JSON.stringify(data), id: "1", retry: 5000 },
            ]),
        });

        const gen = priceSSEStream(options);
        await gen.next();

        expect(logger.log).toHaveBeenCalledWith(
            expect.stringContaining("retry directive"),
        );
        expect(logger.log).toHaveBeenCalledWith(
            expect.stringContaining("5000"),
        );
    });

    it("stops immediately when signal is already aborted", async () => {
        const fetchMock = vi.fn();
        const options = createOptions({
            fetch: fetchMock,
            signal: AbortSignal.abort(),
        });

        const gen = priceSSEStream(options);
        const result = await gen.next();

        expect(result.done).toBe(true);
        expect(result.value).toBeUndefined();
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("stops when fetch throws AbortError", async () => {
        const abortError = new DOMException("The operation was aborted", "AbortError");
        const fetchMock = vi.fn().mockRejectedValueOnce(abortError);
        const options = createOptions({ fetch: fetchMock });

        const gen = priceSSEStream(options);
        const result = await gen.next();

        expect(result.done).toBe(true);
        expect(result.value).toBeUndefined();
    });

    it("resets retry count after successful connection", async () => {
        const data = createHermesResponse();
        const fetchMock = vi.fn()
            .mockRejectedValueOnce(new Error("connection refused"))
            .mockResolvedValueOnce(mockFetchResponse())
            .mockRejectedValueOnce(new Error("connection refused"))
            .mockResolvedValueOnce(mockFetchResponse());

        const eventsFn = vi.fn()
            .mockReturnValueOnce(toAsyncGenerator([
                { data: JSON.stringify(data), id: "1" },
            ]))
            .mockReturnValueOnce(toAsyncGenerator([
                { data: JSON.stringify(data), id: "2" },
            ]));

        const options = createOptions({ fetch: fetchMock, events: eventsFn });
        const gen = priceSSEStream(options);

        const first = await gen.next();
        expect(first.value).toEqual({ priceData: data.parsed[0], vaa: data.binary.data[0] });

        const second = await gen.next();
        expect(second.value).toEqual({ priceData: data.parsed[0], vaa: data.binary.data[0] });
    });

    it("reconnects when stream ends without error", async () => {
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
            .mockResolvedValueOnce(mockFetchResponse())
            .mockResolvedValueOnce(mockFetchResponse());
        const eventsFn = vi.fn()
            .mockReturnValueOnce(toAsyncGenerator([
                { data: JSON.stringify(data1), id: "1" },
            ]))
            .mockReturnValueOnce(toAsyncGenerator([
                { data: JSON.stringify(data2), id: "2" },
            ]));

        const options = createOptions({ fetch: fetchMock, events: eventsFn });
        const gen = priceSSEStream(options);

        const first = await gen.next();
        const second = await gen.next();

        expect(first.value).toEqual({ priceData: data1.parsed[0], vaa: data1.binary.data[0] });
        expect(second.value).toEqual({ priceData: data2.parsed[0], vaa: data2.binary.data[0] });
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("logs connection message", async () => {
        const logger = createLogger();
        const data = createHermesResponse();
        const options = createOptions({
            fetch: vi.fn().mockResolvedValueOnce(mockFetchResponse()),
            logger,
            events: mockEvents([
                { data: JSON.stringify(data), id: "1" },
            ]),
        });

        const gen = priceSSEStream(options);
        await gen.next();

        expect(logger.log).toHaveBeenCalledWith(
            expect.stringContaining("Connecting to Hermes price stream"),
        );
    });

    it("passes signal to events() parser", async () => {
        const controller = new AbortController();
        const fetchResponse = mockFetchResponse();
        const fetchMock = vi.fn().mockResolvedValueOnce(fetchResponse);
        const data = createHermesResponse();
        const eventsFn = mockEvents([
            { data: JSON.stringify(data), id: "1" },
        ]);
        const options = createOptions({ fetch: fetchMock, signal: controller.signal, events: eventsFn });

        const gen = priceSSEStream(options);
        await gen.next();

        expect(eventsFn).toHaveBeenCalledWith(fetchResponse, controller.signal);
    });
});

interface SSEEvent {
    data?: string;
    id?: string | number;
    retry?: number;
    event?: string;
    comment?: string;
}

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

function createOptions(overrides?: Partial<PriceSSEStreamOptions>): PriceSSEStreamOptions {
    return {
        priceFeedId: "abc123",
        baseUrl: "http://localhost:4000",
        unsafeAllowInsecureEndpoints: true,
        fetch: vi.fn(),
        delay: vi.fn().mockResolvedValue(undefined),
        events: mockEvents([]),
        ...overrides,
    };
}

function mockFetchResponse(status = 200): Response {
    return {
        ok: status >= 200 && status < 300,
        status,
    } as unknown as Response;
}

function mockEvents(items: SSEEvent[]) {
    return vi.fn().mockReturnValueOnce(toAsyncGenerator(items));
}

async function* toAsyncGenerator<T>(items: T[]): AsyncGenerator<T> {
    for (const item of items) {
        yield item;
    }
}

function createLogger() {
    return { log: vi.fn(), error: vi.fn(), warn: vi.fn() };
}

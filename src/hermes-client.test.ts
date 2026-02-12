import { SigningCosmWasmClient } from "@cosmjs/cosmwasm-stargate";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mock } from "vitest-mock-extended";
import { HermesClient, HermesConfig, HermesResponse } from "./hermes-client";

// ============================================================
// SEC-01: Mnemonic must never appear in logs or error messages
// ============================================================
describe("SEC-01: Mnemonic leakage prevention", () => {
    const SECRET_MNEMONIC = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

    it("initialize() error must not contain mnemonic", async () => {
        const { client, logger, stargateClient } = setup({
            rpcEndpoint: "https://invalid-host-that-will-fail.example.com:443",
            walletSecret: { type: "mnemonic", value: SECRET_MNEMONIC },
        });

        stargateClient.queryContractSmart.mockRejectedValueOnce(new Error(`${SECRET_MNEMONIC} is not valid`));
        const result = await client.initialize().catch(error => ({ error }));

        expect(result).toHaveProperty("error");
        const { error } = result as { error: Error };
        expect(error.message).not.toContain(SECRET_MNEMONIC);
        expect(error.message).not.toContain(SECRET_MNEMONIC.split(" ")[0]); // Check for partial mnemonic

        // Check all console output
        for (const call of logger.log.mock.calls.concat(logger.error.mock.calls, logger.warn.mock.calls)) {
            const output = call.join(" ");
            expect(output).not.toContain(SECRET_MNEMONIC);
        }
    });
});

// ============================================================
// SEC-02: URL validation must be enforced on endpoints
// ============================================================
describe("SEC-02: Endpoint URL validation in HermesClient", () => {
    it("rejects HTTP RPC endpoints", () => {
        expect(() => setup({
            rpcEndpoint: "http://insecure-rpc.example.com",
        })).toThrow("only HTTPS endpoints are allowed");
    });

    it("rejects SSRF-targeted RPC endpoints (localhost)", () => {
        expect(() => setup({
            rpcEndpoint: "https://localhost:26657",
        })).toThrow("private or internal addresses are not allowed");
    });

    it("rejects SSRF-targeted Hermes endpoints (metadata service)", () => {
        expect(() => setup({
            hermesEndpoint: "https://169.254.169.254/metadata",
        })).toThrow("private or internal addresses are not allowed");
    });

    it("accepts valid HTTPS endpoints", () => {
        const { client } = setup({
            hermesEndpoint: "https://hermes.pyth.network",
        });
        expect(client).toBeDefined();
    });
});

// ============================================================
// SEC-04: Error messages must not leak implementation details
// ============================================================
describe("SEC-04: Error message information leakage", () => {
    it("updatePrice errors do not leak internal paths or stack traces", async () => {
        const { client } = setup();

        // Without initializing, calling updatePrice should fail gracefully
        const result = await client.updatePrice().catch(error => ({ error }));

        expect(result).toHaveProperty("error");
        const { error } = result as { error: Error };
        expect(error.message).not.toMatch(/\/[^\s]+\.(ts|js)/);
        expect(error.message).not.toContain("at ");
        expect(error.message).not.toContain("node_modules");
    });
});

// ============================================================
// SEC-05: Admin operations must validate inputs
// ============================================================
describe("SEC-05: Admin input validation", () => {
    it("transferAdmin rejects invalid address format", async () => {
        const { client } = setup();
        await expect(client.transferAdmin("not-a-valid-address"))
            .rejects.toThrow("Invalid address format");
    });

    it("transferAdmin rejects empty address", async () => {
        const { client } = setup();
        await expect(client.transferAdmin(""))
            .rejects.toThrow("Invalid address format");
    });

    it("updateFee rejects non-numeric fee", async () => {
        const { client } = setup();
        await expect(client.updateFee("abc"))
            .rejects.toThrow("Invalid fee");
    });

    it("updateFee rejects negative fee", async () => {
        const { client } = setup();
        await expect(client.updateFee("-100"))
            .rejects.toThrow("Invalid fee");
    });

    it("updateFee rejects decimal fee", async () => {
        const { client } = setup();
        await expect(client.updateFee("100.5"))
            .rejects.toThrow("Invalid fee");
    });
});

// ============================================================
// SEC-08: Config/status must not expose sensitive data
// ============================================================
describe("SEC-08: Sensitive data in config exposure", () => {
    it("getStatus must not include mnemonic, gasPrice, or internal config", () => {
        const { client } = setup();

        const status = client.getStatus();

        expect(status).toEqual({
            isRunning: false,
            contractAddress: "akash1qypqxpq9qcrsszg2pvxq6rs0zqg3yyc5lzv7xu",
            priceFeedId: undefined,
            address: undefined,
        });
        expect(JSON.stringify(status)).not.toContain("abandon");
    });

    it("getStatus must not include config object or mnemonic when initialized", async () => {
        const { client } = setup();

        await client.initialize();
        const status = client.getStatus();

        expect(status).toEqual({
            isRunning: false,
            contractAddress: "akash1qypqxpq9qcrsszg2pvxq6rs0zqg3yyc5lzv7xu",
            priceFeedId: "test-feed-id",
            address: expect.stringMatching(/^akash1[0-9a-z]{38}$/),
        });
        expect(JSON.stringify(status)).not.toContain("abandon");
    });
});

describe(HermesClient.name, () => {
    describe("constructor", () => {
        it("allows HTTP endpoints when unsafeAllowInsecureEndpoints is true", () => {
            const { client } = setup({
                rpcEndpoint: "http://rpc.akashnet.net",
                unsafeAllowInsecureEndpoints: true,
            });
            expect(client).toBeDefined();
        });

        it("allows private addresses when unsafeAllowInsecureEndpoints is true", () => {
            const { client } = setup({
                rpcEndpoint: "http://localhost:26657",
                unsafeAllowInsecureEndpoints: true,
            });
            expect(client).toBeDefined();
        });

        it("rejects invalid mnemonic word count", () => {
            expect(() => setup({
                walletSecret: { type: "mnemonic", value: "abandon abandon abandon" },
            })).toThrow("Invalid mnemonic");
        });

        it("rejects mnemonic with invalid characters", () => {
            expect(() => setup({
                walletSecret: { type: "mnemonic", value: "Abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon About" },
            })).toThrow("Invalid mnemonic");
        });

        it("accepts a valid private key", () => {
            const { client } = setup({
                walletSecret: { type: "privateKey", value: "0000000000000000000000000000000000000000000000000000000000000001" },
            });
            expect(client).toBeDefined();
        });

        it("rejects an invalid private key", () => {
            expect(() => setup({
                walletSecret: { type: "privateKey", value: "not-a-valid-hex-key" },
            })).toThrow("Invalid private key");
        });
    });

    describe("initialize()", () => {
        it("creates wallet, connects to chain, and fetches price feed ID", async () => {
            const { client, stargateClient } = setup();

            await client.initialize();

            expect(stargateClient.queryContractSmart).toHaveBeenCalledWith(
                "akash1qypqxpq9qcrsszg2pvxq6rs0zqg3yyc5lzv7xu",
                { get_config: {} },
            );
            const status = client.getStatus();
            expect(status.priceFeedId).toBe("test-feed-id");
            expect(status.address).toMatch(/^akash1[0-9a-z]{38}$/);
        });

        it("creates wallet from private key, connects to chain, and fetches price feed ID", async () => {
            const { client, stargateClient } = setup({
                walletSecret: { type: "privateKey", value: "0000000000000000000000000000000000000000000000000000000000000001" },
            });

            await client.initialize();

            expect(stargateClient.queryContractSmart).toHaveBeenCalledWith(
                "akash1qypqxpq9qcrsszg2pvxq6rs0zqg3yyc5lzv7xu",
                { get_config: {} },
            );
            const status = client.getStatus();
            expect(status.priceFeedId).toBe("test-feed-id");
            expect(status.address).toMatch(/^akash1[0-9a-z]{38}$/);
        });

        it("sanitizes and rethrows when initialization fails", async () => {
            const { client, stargateClient } = setup();
            stargateClient.queryContractSmart.mockRejectedValueOnce(
                new Error("connection refused at /internal/path.ts"),
            );

            const error = await client.initialize().catch(e => e);

            expect(error.message).toContain("Failed to initialize Hermes client");
            expect(error.message).not.toContain("/internal/path.ts");
        });
    });

    describe("updatePrice()", () => {
        it("throws when client is not initialized", async () => {
            const { client } = setup();
            await expect(client.updatePrice()).rejects.toThrow("Client not initialized");
        });

        it("fetches price from Hermes and submits VAA when price is stale", async () => {
            const { client, fetch, stargateClient } = setup();

            stargateClient.queryContractSmart
                .mockResolvedValueOnce({ price_feed_id: "test-feed-id" })
                .mockResolvedValueOnce({ price: "12345", conf: "10", expo: -8, publish_time: 1234567880 })
                .mockResolvedValueOnce({ update_fee: "1", wormhole_contract: "akash1wormhole" });
            stargateClient.execute.mockResolvedValueOnce({
                transactionHash: "ABCD1234",
                gasUsed: 500000n,
                gasWanted: 600000n,
                height: 100,
                events: [],
                logs: [],
            });

            await client.initialize();
            await client.updatePrice();

            expect(fetch).toHaveBeenCalledTimes(1);
            expect(stargateClient.execute).toHaveBeenCalledWith(
                expect.stringMatching(/^akash1/),
                "akash1qypqxpq9qcrsszg2pvxq6rs0zqg3yyc5lzv7xu",
                { update_price_feed: { vaa: btoa("some base 64 endcodable data") } },
                "auto",
                undefined,
                [{ denom: "uakt", amount: "1" }],
            );
        });

        it("skips update when price is already up to date", async () => {
            const { client, stargateClient, logger } = setup();

            stargateClient.queryContractSmart
                .mockResolvedValueOnce({ price_feed_id: "test-feed-id" })
                .mockResolvedValueOnce({ publish_time: 1234567890 });

            await client.initialize();
            await client.updatePrice();

            expect(stargateClient.execute).not.toHaveBeenCalled();
            expect(logger.log).toHaveBeenCalledWith(
                expect.stringContaining("already up to date"),
            );
        });

        it("skips update when contract has newer publish_time", async () => {
            const { client, stargateClient } = setup();

            stargateClient.queryContractSmart
                .mockResolvedValueOnce({ price_feed_id: "test-feed-id" })
                .mockResolvedValueOnce({ publish_time: 9999999999 });

            await client.initialize();
            await client.updatePrice();

            expect(stargateClient.execute).not.toHaveBeenCalled();
        });

        it("wraps Hermes HTTP errors with sanitized message", async () => {
            const { client, fetch } = setup();
            await client.initialize();

            fetch.mockResolvedValueOnce(new Response("", { status: 500 }));

            await expect(client.updatePrice()).rejects.toThrow("Failed to update price");
        });

        it("throws when Hermes returns no parsed data", async () => {
            const { client, fetch } = setup();
            await client.initialize();

            fetch.mockResolvedValueOnce(new Response(JSON.stringify({
                parsed: [],
                binary: { data: ["abc"] },
            })));

            await expect(client.updatePrice()).rejects.toThrow("Failed to update price");
        });

        describe("priceDeviationTolerance", () => {
            it("skips update when absolute deviation is within tolerance", async () => {
                const { client, stargateClient, logger } = setup({
                    priceDeviationTolerance: { type: "absolute", value: 1.0 },
                    priceFeed: buildPriceFeed("10000", -2, 2000),
                });
                mockForSkip(stargateClient, { price: "10050", expo: -2, publish_time: 1000 });

                await client.initialize();
                await client.updatePrice();

                expect(stargateClient.execute).not.toHaveBeenCalled();
                expect(logger.log).toHaveBeenCalledWith(
                    expect.stringContaining("absolute tolerance"),
                );
            });

            it("updates when absolute deviation exceeds tolerance", async () => {
                const { client, stargateClient } = setup({
                    priceDeviationTolerance: { type: "absolute", value: 1.0 },
                    priceFeed: buildPriceFeed("10000", -2, 2000),
                });
                mockForUpdate(stargateClient, { price: "10200", expo: -2, publish_time: 1000 });

                await client.initialize();
                await client.updatePrice();

                expect(stargateClient.execute).toHaveBeenCalledTimes(1);
            });

            it("skips update when absolute deviation equals tolerance exactly", async () => {
                const { client, stargateClient, logger } = setup({
                    priceDeviationTolerance: { type: "absolute", value: 1.0 },
                    priceFeed: buildPriceFeed("10000", -2, 2000),
                });
                mockForSkip(stargateClient, { price: "10100", expo: -2, publish_time: 1000 });

                await client.initialize();
                await client.updatePrice();

                expect(stargateClient.execute).not.toHaveBeenCalled();
                expect(logger.log).toHaveBeenCalledWith(
                    expect.stringContaining("absolute tolerance"),
                );
            });

            it("skips update when percentage deviation is within tolerance", async () => {
                const { client, stargateClient, logger } = setup({
                    priceDeviationTolerance: { type: "percentage", value: 1 },
                    priceFeed: buildPriceFeed("10000", -2, 2000),
                });
                mockForSkip(stargateClient, { price: "10050", expo: -2, publish_time: 1000 });

                await client.initialize();
                await client.updatePrice();

                expect(stargateClient.execute).not.toHaveBeenCalled();
                expect(logger.log).toHaveBeenCalledWith(
                    expect.stringContaining("percentage tolerance"),
                );
            });

            it("updates when percentage deviation exceeds tolerance", async () => {
                const { client, stargateClient } = setup({
                    priceDeviationTolerance: { type: "percentage", value: 1 },
                    priceFeed: buildPriceFeed("10000", -2, 2000),
                });
                mockForUpdate(stargateClient, { price: "10500", expo: -2, publish_time: 1000 });

                await client.initialize();
                await client.updatePrice();

                expect(stargateClient.execute).toHaveBeenCalledTimes(1);
            });

            it("skips update when percentage deviation equals tolerance exactly", async () => {
                const { client, stargateClient, logger } = setup({
                    priceDeviationTolerance: { type: "percentage", value: 1 },
                    priceFeed: buildPriceFeed("10100", -2, 2000),
                });
                mockForSkip(stargateClient, { price: "10000", expo: -2, publish_time: 1000 });

                await client.initialize();
                await client.updatePrice();

                expect(stargateClient.execute).not.toHaveBeenCalled();
                expect(logger.log).toHaveBeenCalledWith(
                    expect.stringContaining("percentage tolerance"),
                );
            });

            it("updates on any price difference with default tolerance (absolute 0)", async () => {
                const { client, stargateClient } = setup({
                    priceFeed: buildPriceFeed("10001", -2, 2000),
                });
                mockForUpdate(stargateClient, { price: "10000", expo: -2, publish_time: 1000 });

                await client.initialize();
                await client.updatePrice();

                expect(stargateClient.execute).toHaveBeenCalledTimes(1);
            });

            it("handles different exponents between new and current price", async () => {
                const { client, stargateClient } = setup({
                    priceDeviationTolerance: { type: "absolute", value: 1.0 },
                    priceFeed: buildPriceFeed("1000000", -4, 2000),
                });
                mockForUpdate(stargateClient, { price: "10200", expo: -2, publish_time: 1000 });

                await client.initialize();
                await client.updatePrice();

                expect(stargateClient.execute).toHaveBeenCalledTimes(1);
            });

            it("handles zero current price when calculating percentage deviation", async () => {
                const { client, stargateClient } = setup({
                    priceDeviationTolerance: { type: "percentage", value: 10 },
                    priceFeed: buildPriceFeed("10000", -2, 2000),
                });
                mockForUpdate(stargateClient, { price: "0", expo: -2, publish_time: 1000 });

                await client.initialize();
                await client.updatePrice();

                expect(stargateClient.execute).toHaveBeenCalledTimes(1);
            });
        });

        it("throws when Hermes returns no binary data", async () => {
            const { client, fetch } = setup();
            await client.initialize();

            fetch.mockResolvedValueOnce(new Response(JSON.stringify({
                parsed: [{
                    id: "test",
                    price: { price: "100", conf: "1", expo: -8, publish_time: 123 },
                    ema_price: { price: "100", conf: "1", expo: -8, publish_time: 123 },
                }],
                binary: { data: [] },
            })));

            await expect(client.updatePrice()).rejects.toThrow("Failed to update price");
        });

        function mockForUpdate(stargateClient: ReturnType<typeof setup>["stargateClient"], currentPrice: { price: string; expo: number; publish_time: number }) {
            stargateClient.queryContractSmart
                .mockResolvedValueOnce({ price_feed_id: "test-feed-id" })
                .mockResolvedValueOnce({ price: currentPrice.price, conf: "10", expo: currentPrice.expo, publish_time: currentPrice.publish_time })
                .mockResolvedValueOnce({ update_fee: "1", wormhole_contract: "akash1wormhole" });
            stargateClient.execute.mockResolvedValueOnce({
                transactionHash: "TX_DEV",
                gasUsed: 500000n,
                gasWanted: 600000n,
                height: 100,
                events: [],
                logs: [],
            });
        }

        function mockForSkip(stargateClient: ReturnType<typeof setup>["stargateClient"], currentPrice: { price: string; expo: number; publish_time: number }) {
            stargateClient.queryContractSmart
                .mockResolvedValueOnce({ price_feed_id: "test-feed-id" })
                .mockResolvedValueOnce({ price: currentPrice.price, conf: "10", expo: currentPrice.expo, publish_time: currentPrice.publish_time });
        }
    });

    describe("queryCurrentPrice()", () => {
        it("throws when client is not initialized", async () => {
            const { client } = setup();
            await expect(client.queryCurrentPrice()).rejects.toThrow("Client not initialized");
        });

        it("queries contract for current price", async () => {
            const { client, stargateClient } = setup();
            const expectedPrice = { price: "12345", conf: "10", expo: -8, publish_time: 1000 };

            stargateClient.queryContractSmart
                .mockResolvedValueOnce({ price_feed_id: "test-feed-id" })
                .mockResolvedValueOnce(expectedPrice);

            await client.initialize();
            const result = await client.queryCurrentPrice();

            expect(result).toEqual(expectedPrice);
            expect(stargateClient.queryContractSmart).toHaveBeenLastCalledWith(
                "akash1qypqxpq9qcrsszg2pvxq6rs0zqg3yyc5lzv7xu",
                { get_price: {} },
            );
        });
    });

    describe("queryPriceFeed()", () => {
        it("throws when client is not initialized", async () => {
            const { client } = setup();
            await expect(client.queryPriceFeed()).rejects.toThrow("Client not initialized");
        });

        it("queries contract for price feed", async () => {
            const { client, stargateClient } = setup();
            const expectedFeed = {
                symbol: "AKT/USD",
                price: "12345",
                conf: "10",
                expo: -8,
                publish_time: 1000,
                prev_publish_time: 900,
            };

            stargateClient.queryContractSmart
                .mockResolvedValueOnce({ price_feed_id: "test-feed-id" })
                .mockResolvedValueOnce(expectedFeed);

            await client.initialize();
            const result = await client.queryPriceFeed();

            expect(result).toEqual(expectedFeed);
            expect(stargateClient.queryContractSmart).toHaveBeenLastCalledWith(
                "akash1qypqxpq9qcrsszg2pvxq6rs0zqg3yyc5lzv7xu",
                { get_price_feed: {} },
            );
        });
    });

    describe("queryConfig()", () => {
        it("queries contract for config", async () => {
            const { client, stargateClient } = setup();
            const expectedConfig = {
                admin: "akash1admin",
                wormhole_contract: "akash1wormhole",
                update_fee: "100",
                price_feed_id: "test-feed-id",
                default_denom: "uakt",
                default_base_denom: "akt",
                data_sources: [],
            };

            stargateClient.queryContractSmart
                .mockResolvedValueOnce({ price_feed_id: "test-feed-id" })
                .mockResolvedValueOnce(expectedConfig);

            await client.initialize();
            const result = await client.queryConfig();

            expect(result).toEqual(expectedConfig);
            expect(stargateClient.queryContractSmart).toHaveBeenLastCalledWith(
                "akash1qypqxpq9qcrsszg2pvxq6rs0zqg3yyc5lzv7xu",
                { get_config: {} },
            );
        });
    });

    describe("queryOracleParams()", () => {
        it("queries contract for oracle params", async () => {
            const { client, stargateClient } = setup();
            const expectedParams = {
                max_price_deviation_bps: 500,
                min_price_sources: 1,
                max_price_staleness_blocks: 100,
                twap_window: 300,
                last_updated_height: 50,
            };

            stargateClient.queryContractSmart
                .mockResolvedValueOnce({ price_feed_id: "test-feed-id" })
                .mockResolvedValueOnce(expectedParams);

            await client.initialize();
            const result = await client.queryOracleParams();

            expect(result).toEqual(expectedParams);
            expect(stargateClient.queryContractSmart).toHaveBeenLastCalledWith(
                "akash1qypqxpq9qcrsszg2pvxq6rs0zqg3yyc5lzv7xu",
                { get_oracle_params: {} },
            );
        });
    });

    describe("refreshOracleParams()", () => {
        it("throws when client is not initialized", async () => {
            const { client } = setup();
            await expect(client.refreshOracleParams()).rejects.toThrow("Client not initialized");
        });

        it("executes refresh_oracle_params on contract and returns tx hash", async () => {
            const { client, stargateClient } = setup();
            stargateClient.execute.mockResolvedValueOnce({
                transactionHash: "TX_REFRESH",
                gasUsed: 100000n,
                gasWanted: 150000n,
                height: 200,
                events: [],
                logs: [],
            });

            await client.initialize();
            const txHash = await client.refreshOracleParams();

            expect(txHash).toBe("TX_REFRESH");
            expect(stargateClient.execute).toHaveBeenCalledWith(
                expect.stringMatching(/^akash1/),
                "akash1qypqxpq9qcrsszg2pvxq6rs0zqg3yyc5lzv7xu",
                { refresh_oracle_params: {} },
                "auto",
            );
        });
    });

    describe("updateFee()", () => {
        it("throws when client is not initialized", async () => {
            const { client } = setup();
            await expect(client.updateFee("100")).rejects.toThrow("Client not initialized");
        });

        it("executes update_fee on contract and returns tx hash", async () => {
            const { client, stargateClient } = setup();
            stargateClient.execute.mockResolvedValueOnce({
                transactionHash: "TX_FEE",
                gasUsed: 100000n,
                gasWanted: 150000n,
                height: 200,
                events: [],
                logs: [],
            });

            await client.initialize();
            const txHash = await client.updateFee("500");

            expect(txHash).toBe("TX_FEE");
            expect(stargateClient.execute).toHaveBeenCalledWith(
                expect.stringMatching(/^akash1/),
                "akash1qypqxpq9qcrsszg2pvxq6rs0zqg3yyc5lzv7xu",
                { update_fee: { new_fee: "500" } },
                "auto",
            );
        });
    });

    describe("transferAdmin()", () => {
        it("throws when client is not initialized", async () => {
            const { client } = setup();
            await expect(
                client.transferAdmin("akash1qypqxpq9qcrsszg2pvxq6rs0zqg3yyc5lzv7xu"),
            ).rejects.toThrow("Client not initialized");
        });

        it("executes transfer_admin on contract and returns tx hash", async () => {
            const { client, stargateClient } = setup();
            const newAdmin = "akash1qypqxpq9qcrsszg2pvxq6rs0zqg3yyc5lzv7xu";
            stargateClient.execute.mockResolvedValueOnce({
                transactionHash: "TX_ADMIN",
                gasUsed: 100000n,
                gasWanted: 150000n,
                height: 200,
                events: [],
                logs: [],
            });

            await client.initialize();
            const txHash = await client.transferAdmin(newAdmin);

            expect(txHash).toBe("TX_ADMIN");
            expect(stargateClient.execute).toHaveBeenCalledWith(
                expect.stringMatching(/^akash1/),
                "akash1qypqxpq9qcrsszg2pvxq6rs0zqg3yyc5lzv7xu",
                { transfer_admin: { new_admin: newAdmin } },
                "auto",
            );
        });
    });

    describe("start()", () => {
        afterEach(() => {
            vi.useRealTimers();
        });

        it("starts once if called concurrently", async () => {
            const { client, stargateClient, fetch } = setup();
            const start = client.start.bind(client);
            const abortController = new AbortController();

            stargateClient.queryContractSmart
                .mockResolvedValueOnce({ price_feed_id: "test-feed-id" })
                .mockResolvedValueOnce({ price: "12345", conf: "10", expo: -8, publish_time: 1234567880 })
                .mockResolvedValueOnce({ update_fee: "1", wormhole_contract: "akash1wormhole" });
            stargateClient.execute.mockResolvedValueOnce({
                transactionHash: "TX_CONCURRENT",
                gasUsed: 500000n,
                gasWanted: 600000n,
                height: 100,
                events: [],
                logs: [],
            });

            await Promise.all([
                start({ signal: abortController.signal }),
                start({ signal: abortController.signal }),
                start({ signal: abortController.signal }),
                start({ signal: abortController.signal }),
            ]).finally(() => abortController.abort());

            expect(stargateClient.execute).toHaveBeenCalledTimes(1);
            expect(fetch).toHaveBeenCalledTimes(1);
        });

        it("logs and returns when already running", async () => {
            const { client, logger, stargateClient } = setup();
            const abortController = new AbortController();

            stargateClient.queryContractSmart
                .mockResolvedValueOnce({ price_feed_id: "test-feed-id" })
                .mockResolvedValueOnce({ publish_time: 1234567890 });

            try {
                await client.start({ signal: abortController.signal });
                await client.start({ signal: abortController.signal });
            } finally {
                abortController.abort();
            }

            expect(logger.log).toHaveBeenCalledWith("Hermes client is already running");
        });

        it("initializes client when not already initialized", async () => {
            const { client, stargateClient } = setup();

            stargateClient.queryContractSmart
                .mockResolvedValueOnce({ price_feed_id: "test-feed-id" })
                .mockResolvedValueOnce({ publish_time: 1234567890 });

            const abortController = new AbortController();
            try {
                await client.start({ signal: abortController.signal });
                const status = client.getStatus();
                expect(status.isRunning).toBe(true);
                expect(status.priceFeedId).toBe("test-feed-id");
                expect(status.address).toMatch(/^akash1/);
            } finally {
                abortController.abort();
            }
        });

        it("skips initialization when already initialized", async () => {
            const { client, stargateClient } = setup();

            stargateClient.queryContractSmart
                .mockResolvedValueOnce({ price_feed_id: "test-feed-id" })
                .mockResolvedValueOnce({ publish_time: 1234567890 });

            await client.initialize();
            await callAndAbort(client.start.bind(client));

            expect(stargateClient.queryContractSmart).toHaveBeenCalledTimes(2);
        });

        it("stops when abort signal fires", async () => {
            const { client, stargateClient, logger } = setup();
            const ac = new AbortController();

            stargateClient.queryContractSmart
                .mockResolvedValueOnce({ price_feed_id: "test-feed-id" })
                .mockResolvedValueOnce({ publish_time: 1234567890 });

            await client.start({ signal: ac.signal });
            expect(client.getStatus().isRunning).toBe(true);

            ac.abort();
            expect(client.getStatus().isRunning).toBe(false);
            expect(logger.log).toHaveBeenCalledWith("Hermes client stopped");
        });

        it("continues running when updatePrice throws", async () => {
            const { client, stargateClient, fetch, logger } = setup();

            stargateClient.queryContractSmart
                .mockResolvedValueOnce({ price_feed_id: "test-feed-id" });
            fetch.mockResolvedValueOnce(new Response("", { status: 500 }));
            const abortController = new AbortController();

            try {
                await client.start({ signal: abortController.signal });

                expect(client.getStatus().isRunning).toBe(true);
                expect(logger.error).toHaveBeenCalledWith(
                    "Error in scheduled update:",
                    expect.any(Error),
                );
            } finally {
                abortController.abort();
            }
        });

        it("sets isRunning to false when initialization fails", async () => {
            const { client, stargateClient } = setup();

            stargateClient.queryContractSmart.mockRejectedValueOnce(
                new Error("connection refused"),
            );

            const ac = new AbortController();
            try {
                await expect(client.start({ signal: ac.signal })).rejects.toThrow("Failed to start Hermes client");
                expect(client.getStatus().isRunning).toBe(false);
            } finally {
                ac.abort();
            }
        });

        it("schedules periodic updates after initial update", async () => {
            vi.useFakeTimers();
            const { client, stargateClient, fetch } = setup({
                updateIntervalMs: 10_000,
            });

            stargateClient.queryContractSmart
                .mockResolvedValueOnce({ price_feed_id: "test-feed-id" })
                .mockResolvedValueOnce({ publish_time: 1234567890 })
                .mockResolvedValueOnce({ publish_time: 1234567890 });

            const abortController = new AbortController();
            try {
                await client.start({ signal: abortController.signal });
                expect(fetch).toHaveBeenCalledTimes(1);

                await vi.advanceTimersByTimeAsync(10000);
                expect(fetch).toHaveBeenCalledTimes(2);
            } finally {
                abortController.abort();
            }
        });

        function callAndAbort(fn: (input: { signal: AbortSignal }) => Promise<void>) {
            const abortController = new AbortController();
            return fn({ signal: abortController.signal }).finally(() => abortController.abort());
        }
    });
});

function setup(input?: Partial<HermesConfig> & {
    priceFeed?: HermesResponse;
}) {
    const fetch = vi.fn(async () => new Response(JSON.stringify(input?.priceFeed ?? {
        parsed: [
            { price: { price: "123.45", conf: "0.01", expo: -8, publish_time: 1234567890 }, ema_price: { price: "123.45", conf: "0.01", expo: -8, publish_time: 1234567890 }, id: "test-id" },
        ],
        binary: {
            data: [btoa("some base 64 endcodable data")],
        },
    } satisfies HermesResponse)));
    const stargateClient = mock<SigningCosmWasmClient>({
        queryContractSmart: vi.fn(async () => ({ price_feed_id: "test-feed-id" })),
    });
    const logger = mock<Console>();
    const client = new HermesClient({
        rpcEndpoint: input?.rpcEndpoint ?? "https://rpc.akashnet.net:443",
        contractAddress: input?.contractAddress ?? "akash1qypqxpq9qcrsszg2pvxq6rs0zqg3yyc5lzv7xu",
        walletSecret: input?.walletSecret ?? { type: "mnemonic", value: "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about" },
        gasPrice: input?.gasPrice ?? "0.025uakt",
        fetch,
        connectWithSigner: async () => stargateClient,
        logger,
        updateIntervalMs: input?.updateIntervalMs ?? 300_000,
        hermesEndpoint: input?.hermesEndpoint ?? "https://hermes.pyth.network",
        unsafeAllowInsecureEndpoints: input?.unsafeAllowInsecureEndpoints,
        priceDeviationTolerance: input?.priceDeviationTolerance ?? { type: "absolute", value: 0 },
    });

    return { client, fetch, logger, stargateClient };
}

function buildPriceFeed(price: string, expo: number, publishTime: number): HermesResponse {
    return {
        parsed: [{
            id: "test-id",
            price: { price, conf: "10", expo, publish_time: publishTime },
            ema_price: { price, conf: "10", expo, publish_time: publishTime },
        }],
        binary: { data: [btoa("vaa-data")] },
    };
}

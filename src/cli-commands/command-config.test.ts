import { describe, it, expect } from "vitest";
import { parseConfig } from "./command-config.ts";

function validEnv(overrides: Record<string, string | undefined> = {}) {
    return {
        CONTRACT_ADDRESS: "akash1qypqxpq9qcrsszg2pvxq6rs0zqg3yyc5lzv7xu",
        WALLET_SECRET: "mnemonic:abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about",
        ...overrides,
    };
}

describe("parseConfig", () => {
    it("returns error when CONTRACT_ADDRESS is missing", () => {
        const result = parseConfig({
            WALLET_SECRET: "mnemonic:abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about",
        });

        expect(result.ok).toBe(false);
        expect((result as Extract<typeof result, { ok: false }>).error).toContain("CONTRACT_ADDRESS");
    });

    it("returns error when WALLET_SECRET is missing", () => {
        const result = parseConfig({ CONTRACT_ADDRESS: "akash1qypqxpq9qcrsszg2pvxq6rs0zqg3yyc5lzv7xu" });

        expect(result.ok).toBe(false);
        expect((result as Extract<typeof result, { ok: false }>).error).toContain("WALLET_SECRET");
    });

    it("returns error when WALLET_SECRET has invalid format", () => {
        const result = parseConfig(validEnv({ WALLET_SECRET: "invalid-format" }));

        expect(result.ok).toBe(false);
        expect((result as Extract<typeof result, { ok: false }>).error).toContain("WALLET_SECRET");
    });

    it("returns ok with parsed config for valid input", () => {
        const result = parseConfig(validEnv());

        expect(result.ok).toBe(true);
        expect((result as Extract<typeof result, { ok: true }>).value).toMatchObject({
            contractAddress: "akash1qypqxpq9qcrsszg2pvxq6rs0zqg3yyc5lzv7xu",
            walletSecret: {
                type: "mnemonic",
                value: "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about",
            },
        });
    });

    it("parses privateKey wallet secret", () => {
        const result = parseConfig(validEnv({
            WALLET_SECRET: "privateKey:" + "ab".repeat(32),
        }));

        expect(result.ok).toBe(true);
        expect((result as Extract<typeof result, { ok: true }>).value.walletSecret).toEqual({
            type: "privateKey",
            value: "ab".repeat(32),
        });
    });

    it("uses default rpcEndpoint when RPC_ENDPOINT is not provided", () => {
        const result = parseConfig(validEnv());

        expect(result.ok).toBe(true);
        expect((result as Extract<typeof result, { ok: true }>).value.rpcEndpoint).toBe("https://rpc.akashnet.net:443");
    });

    it("uses custom RPC_ENDPOINT when provided", () => {
        const result = parseConfig(validEnv({ RPC_ENDPOINT: "https://custom-rpc:443" }));

        expect(result.ok).toBe(true);
        expect((result as Extract<typeof result, { ok: true }>).value.rpcEndpoint).toBe("https://custom-rpc:443");
    });

    it("passes HERMES_ENDPOINT to config", () => {
        const result = parseConfig(validEnv({ HERMES_ENDPOINT: "https://hermes.example.com" }));

        expect(result.ok).toBe(true);
        expect((result as Extract<typeof result, { ok: true }>).value.hermesEndpoint).toBe("https://hermes.example.com");
    });

    it("uses default hermesEndpoint when HERMES_ENDPOINT is not provided", () => {
        const result = parseConfig(validEnv());

        expect(result.ok).toBe(true);
        expect((result as Extract<typeof result, { ok: true }>).value.hermesEndpoint).toBe("https://hermes.pyth.network");
    });

    it("parses UPDATE_INTERVAL_MS as integer", () => {
        const result = parseConfig(validEnv({ UPDATE_INTERVAL_MS: "5000" }));

        expect(result.ok).toBe(true);
        expect((result as Extract<typeof result, { ok: true }>).value.updateIntervalMs).toBe(5000);
    });

    it("uses default updateIntervalMs when UPDATE_INTERVAL_MS is not provided", () => {
        const result = parseConfig(validEnv());

        expect(result.ok).toBe(true);
        expect((result as Extract<typeof result, { ok: true }>).value.updateIntervalMs).toBe(5 * 60 * 1000);
    });

    it("returns error when UPDATE_INTERVAL_MS is not a valid integer", () => {
        const result = parseConfig(validEnv({ UPDATE_INTERVAL_MS: "abc" }));

        expect(result.ok).toBe(false);
        expect((result as Extract<typeof result, { ok: false }>).error).toContain("UPDATE_INTERVAL_MS");
    });

    it("sets unsafeAllowInsecureEndpoints to false when NODE_ENV is production", () => {
        const result = parseConfig(validEnv({ NODE_ENV: "production" }));

        expect(result.ok).toBe(true);
        expect((result as Extract<typeof result, { ok: true }>).value.unsafeAllowInsecureEndpoints).toBe(false);
    });

    it("sets unsafeAllowInsecureEndpoints to false when NODE_ENV is undefined", () => {
        const result = parseConfig(validEnv());

        expect(result.ok).toBe(true);
        expect((result as Extract<typeof result, { ok: true }>).value.unsafeAllowInsecureEndpoints).toBe(false);
    });

    it("sets unsafeAllowInsecureEndpoints to true when NODE_ENV is development", () => {
        const result = parseConfig(validEnv({ NODE_ENV: "development" }));

        expect(result.ok).toBe(true);
        expect((result as Extract<typeof result, { ok: true }>).value.unsafeAllowInsecureEndpoints).toBe(true);
    });
});

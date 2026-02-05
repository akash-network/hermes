import { sanitizeError, sanitizeAxiosError, wrapWalletError } from "../src/errors";
import { AxiosError, AxiosHeaders } from "axios";

describe("sanitizeError", () => {
    it("strips stack traces (file paths)", () => {
        const err = new Error("something failed");
        err.message = "Error at /home/user/project/src/file.ts:42:10";
        const result = sanitizeError(err);
        expect(result).not.toContain("/home/user");
        expect(result).toContain("[path]");
    });

    it("handles non-Error objects", () => {
        expect(sanitizeError(42)).toBe("An unknown error occurred");
        expect(sanitizeError(null)).toBe("An unknown error occurred");
        expect(sanitizeError(undefined)).toBe("An unknown error occurred");
        expect(sanitizeError({ foo: "bar" })).toBe("An unknown error occurred");
    });

    it("does not include file paths", () => {
        const err = new Error("Failed at /var/app/src/hermes-client.ts:123");
        const result = sanitizeError(err);
        expect(result).not.toContain("/var/app");
        expect(result).not.toMatch(/\.ts:\d+/);
    });

    it("handles string errors", () => {
        const result = sanitizeError("simple error message");
        expect(result).toBe("simple error message");
    });
});

describe("sanitizeAxiosError", () => {
    function makeAxiosError(status: number, data?: unknown): AxiosError {
        const headers = new AxiosHeaders();
        const error = new AxiosError("Request failed", "ERR_BAD_RESPONSE", undefined, undefined, {
            status,
            statusText: "Bad Request",
            headers,
            config: { headers },
            data: data ?? { message: "detailed internal error info" },
        });
        return error;
    }

    it("only returns status code and generic message", () => {
        const err = makeAxiosError(500, { message: "internal server details" });
        const result = sanitizeAxiosError(err);
        expect(result).toBe("Hermes API request failed with status 500");
        expect(result).not.toContain("internal server details");
    });

    it("does not forward response.data.message", () => {
        const err = makeAxiosError(400, {
            message: "Secret internal info about endpoint",
        });
        const result = sanitizeAxiosError(err);
        expect(result).not.toContain("Secret internal info");
    });

    it("handles axios error without response", () => {
        const err = new AxiosError("Network Error", "ERR_NETWORK");
        const result = sanitizeAxiosError(err);
        expect(result).toBe("Hermes API request failed (no response)");
    });

    it("falls back to sanitizeError for non-axios errors", () => {
        const err = new Error("something else");
        const result = sanitizeAxiosError(err);
        expect(result).toBe("something else");
    });
});

describe("wrapWalletError", () => {
    it("does not leak mnemonic", () => {
        const mnemonic =
            "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
        const originalError = new Error(`Invalid mnemonic: ${mnemonic}`);
        const wrapped = wrapWalletError(originalError);
        expect(wrapped.message).not.toContain("abandon");
        expect(wrapped.message).not.toContain(mnemonic);
    });

    it("returns generic message", () => {
        const wrapped = wrapWalletError(new Error("whatever"));
        expect(wrapped.message).toBe(
            "Failed to initialize wallet. Check your mnemonic."
        );
    });

    it("returns Error instance", () => {
        const wrapped = wrapWalletError("string error");
        expect(wrapped).toBeInstanceOf(Error);
    });
});

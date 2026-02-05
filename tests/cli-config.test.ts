import { parsePositiveInt, validateBech32Address, validateFee } from "../src/validation";

describe("CLI config loading — parsePositiveInt for UPDATE_INTERVAL_MS", () => {
    it("returns undefined for garbage input (prevents NaN in setInterval)", () => {
        expect(parsePositiveInt("garbage")).toBeUndefined();
    });

    it("returns undefined for empty string", () => {
        expect(parsePositiveInt("")).toBeUndefined();
    });

    it("returns undefined for negative values", () => {
        expect(parsePositiveInt("-5000")).toBeUndefined();
    });

    it("parses valid interval", () => {
        expect(parsePositiveInt("300000")).toBe(300000);
    });
});

describe("CLI admin command validation", () => {
    it("adminUpdateFee rejects non-numeric fee at CLI layer", () => {
        expect(() => validateFee("not-a-number")).toThrow(
            "non-negative integer string"
        );
    });

    it("adminUpdateFee rejects negative fee at CLI layer", () => {
        expect(() => validateFee("-100")).toThrow("non-negative integer string");
    });

    it("adminTransfer rejects invalid address at CLI layer", () => {
        expect(() => validateBech32Address("cosmos1abc")).toThrow(
            "must start with 'akash1'"
        );
    });

    it("adminTransfer rejects empty address at CLI layer", () => {
        expect(() => validateBech32Address("")).toThrow("address is empty");
    });
});

describe("CLI error sanitization integration", () => {
    it("cli.ts uses sanitizeError for all catch blocks", async () => {
        const fs = await import("fs");
        const source = fs.readFileSync(
            require.resolve("../src/cli"),
            "utf-8"
        );

        // Should not have any raw error object logging
        expect(source).not.toMatch(/console\.error\([^)]*,\s*error\s*\)/);

        // Every catch block should use sanitizeError
        const catchBlocks = source.match(/catch\s*\(error\)\s*\{[^}]+\}/g) || [];
        expect(catchBlocks.length).toBeGreaterThan(0);
        for (const block of catchBlocks) {
            expect(block).toContain("sanitizeError(error)");
        }
    });
});

describe("CLI loadConfig validation integration", () => {
    it("cli.ts validates inputs in loadConfig", async () => {
        const fs = await import("fs");
        const source = fs.readFileSync(
            require.resolve("../src/cli"),
            "utf-8"
        );

        expect(source).toContain("validateUrl(config.rpc)");
        expect(source).toContain("validateBech32Address(config.contract)");
        expect(source).toContain("validateMnemonic(config.mnemonic)");
        expect(source).toContain("parsePositiveInt(process.env.UPDATE_INTERVAL_MS)");
    });
});

import {
    parsePositiveInt,
    validateMnemonic,
    validateBech32Address,
    validateUrl,
    validateFee,
    validateGasPrice,
} from "../src/validation";

describe("parsePositiveInt", () => {
    it("rejects NaN from non-numeric string", () => {
        expect(parsePositiveInt("abc")).toBeUndefined();
    });

    it("rejects negative intervals", () => {
        expect(parsePositiveInt("-100")).toBeUndefined();
    });

    it("rejects zero interval", () => {
        expect(parsePositiveInt("0")).toBeUndefined();
    });

    it("accepts valid positive integer", () => {
        expect(parsePositiveInt("5000")).toBe(5000);
    });

    it("returns undefined for undefined input", () => {
        expect(parsePositiveInt(undefined)).toBeUndefined();
    });
});

describe("validateMnemonic", () => {
    const VALID_12 =
        "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
    const VALID_24 =
        "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art";

    it("rejects mnemonic with wrong word count", () => {
        expect(() => validateMnemonic("one two three")).toThrow(
            "expected 12 or 24 words, got 3"
        );
    });

    it("rejects mnemonic with empty words", () => {
        // double space creates an empty word
        const bad =
            "abandon  abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
        expect(() => validateMnemonic(bad)).toThrow("contains empty words");
    });

    it("rejects mnemonic with leading/trailing whitespace", () => {
        expect(() => validateMnemonic(` ${VALID_12}`)).toThrow(
            "leading or trailing whitespace"
        );
        expect(() => validateMnemonic(`${VALID_12} `)).toThrow(
            "leading or trailing whitespace"
        );
    });

    it("accepts valid 12-word mnemonic", () => {
        expect(() => validateMnemonic(VALID_12)).not.toThrow();
    });

    it("accepts valid 24-word mnemonic", () => {
        expect(() => validateMnemonic(VALID_24)).not.toThrow();
    });
});

describe("validateBech32Address", () => {
    const VALID_ADDRESS = "akash1qypqxpq9qcrsszg2pvxq6rs0zqg3yyc5lzv7xu";

    it("rejects address without akash1 prefix", () => {
        expect(() => validateBech32Address("cosmos1abc")).toThrow(
            "must start with 'akash1'"
        );
    });

    it("rejects address that is too short", () => {
        expect(() => validateBech32Address("akash1short")).toThrow(
            "unexpected length"
        );
    });

    it("rejects empty address", () => {
        expect(() => validateBech32Address("")).toThrow("address is empty");
    });

    it("accepts valid akash1 address", () => {
        expect(() => validateBech32Address(VALID_ADDRESS)).not.toThrow();
    });
});

describe("validateUrl", () => {
    it("rejects non-URL strings", () => {
        expect(() => validateUrl("not-a-url")).toThrow("not a valid URL");
    });

    it("rejects URLs without http/https protocol", () => {
        expect(() => validateUrl("ftp://example.com")).toThrow(
            "protocol must be http or https"
        );
    });

    it("accepts valid https URL", () => {
        expect(() => validateUrl("https://rpc.akashnet.net:443")).not.toThrow();
    });

    it("accepts valid http URL", () => {
        expect(() => validateUrl("http://localhost:26657")).not.toThrow();
    });
});

describe("validateFee", () => {
    it("rejects negative fee", () => {
        expect(() => validateFee("-100")).toThrow("non-negative integer string");
    });

    it("rejects non-numeric fee", () => {
        expect(() => validateFee("abc")).toThrow("non-negative integer string");
    });

    it("rejects fee with decimals", () => {
        expect(() => validateFee("1.5")).toThrow("non-negative integer string");
    });

    it("accepts valid fee string", () => {
        expect(() => validateFee("1000")).not.toThrow();
    });

    it("accepts zero fee", () => {
        expect(() => validateFee("0")).not.toThrow();
    });
});

describe("validateGasPrice", () => {
    it("rejects gas price without denom", () => {
        expect(() => validateGasPrice("0.025")).toThrow("must match format");
    });

    it("rejects gas price with invalid number", () => {
        expect(() => validateGasPrice("uakt")).toThrow("must match format");
    });

    it("accepts valid gas price format", () => {
        expect(() => validateGasPrice("0.025uakt")).not.toThrow();
    });
});

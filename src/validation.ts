/**
 * Input validation utilities for Hermes client configuration and admin commands.
 */

/**
 * Parse a string as a positive integer. Returns undefined for invalid/non-positive values.
 * Prevents NaN from reaching setInterval() which would cause a tight loop.
 */
export function parsePositiveInt(value: string | undefined): number | undefined {
    if (value === undefined) return undefined;
    const parsed = parseInt(value, 10);
    if (isNaN(parsed) || parsed <= 0) return undefined;
    return parsed;
}

/**
 * Validate a BIP-39 mnemonic format (12 or 24 words, no empty words, no extra whitespace).
 * Does NOT verify against a wordlist — only checks structural validity.
 * Throws on invalid format to prevent cryptic CosmJS errors that could leak the mnemonic.
 */
export function validateMnemonic(mnemonic: string): void {
    if (mnemonic !== mnemonic.trim()) {
        throw new Error("Invalid mnemonic: must not have leading or trailing whitespace");
    }
    const words = mnemonic.split(" ");
    if (words.some((w) => w === "")) {
        throw new Error("Invalid mnemonic: contains empty words (double spaces)");
    }
    if (words.length !== 12 && words.length !== 24) {
        throw new Error(
            `Invalid mnemonic: expected 12 or 24 words, got ${words.length}`
        );
    }
}

/**
 * Validate an Akash bech32 address format.
 * Checks prefix and reasonable length range.
 */
export function validateBech32Address(address: string): void {
    if (!address) {
        throw new Error("Invalid address: address is empty");
    }
    if (!address.startsWith("akash1")) {
        throw new Error("Invalid address: must start with 'akash1'");
    }
    if (address.length < 44 || address.length > 64) {
        throw new Error(
            `Invalid address: unexpected length ${address.length} (expected 44-64)`
        );
    }
}

/**
 * Validate a URL string. Requires http:// or https:// protocol.
 */
export function validateUrl(url: string): void {
    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        throw new Error(`Invalid URL: '${url}' is not a valid URL`);
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        throw new Error(
            `Invalid URL: protocol must be http or https, got '${parsed.protocol}'`
        );
    }
}

/**
 * Validate a fee string for the updateFee admin command.
 * Must be a non-negative integer string (uint256 format).
 */
export function validateFee(fee: string): void {
    if (!/^\d+$/.test(fee)) {
        throw new Error(
            "Invalid fee: must be a non-negative integer string (e.g., '1000')"
        );
    }
}

/**
 * Validate gas price format (e.g., "0.025uakt").
 * Must match <number><denom> pattern.
 */
export function validateGasPrice(gasPrice: string): void {
    if (!/^\d+(\.\d+)?[a-zA-Z]+$/.test(gasPrice)) {
        throw new Error(
            `Invalid gas price: '${gasPrice}' must match format '<number><denom>' (e.g., '0.025uakt')`
        );
    }
}

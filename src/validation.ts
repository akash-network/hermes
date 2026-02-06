/**
 * Input validation and sanitization utilities for security-critical operations
 */

/**
 * Validate that a URL uses HTTPS and has a valid structure.
 * Prevents SSRF by rejecting non-HTTPS schemes and private/internal addresses.
 */
export function validateEndpointUrl(url: string, fieldName: string): string {
    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        throw new Error(`Invalid ${fieldName}: not a valid URL`);
    }

    // In development mode, allow HTTP and private addresses
    const isDev = process.env.NODE_ENV !== 'production';

    if (!isDev && parsed.protocol !== 'https:') {
        throw new Error(`Invalid ${fieldName}: only HTTPS endpoints are allowed`);
    }

    // Allow http or https in dev, only https in production
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
        throw new Error(`Invalid ${fieldName}: only HTTP/HTTPS endpoints are allowed`);
    }

    // Block private/internal IP ranges to prevent SSRF (production only)
    if (!isDev) {
        const hostname = parsed.hostname.toLowerCase();
        const blockedPatterns = [
            /^localhost$/,
            /^127\./,
            /^10\./,
            /^172\.(1[6-9]|2\d|3[01])\./,
            /^192\.168\./,
            /^0\./,
            /^\[::1\]$/,
            /^\[fd/,      // IPv6 private
            /^\[fe80:/,   // IPv6 link-local
            /^169\.254\./, // link-local
            /\.local$/,
        ];

        for (const pattern of blockedPatterns) {
            if (pattern.test(hostname)) {
                throw new Error(`Invalid ${fieldName}: private or internal addresses are not allowed`);
            }
        }
    }

    return url;
}

/**
 * Validate that an Akash address has the correct format.
 * Akash addresses are bech32 encoded with the "akash" prefix.
 */
export function validateAkashAddress(address: string): string {
    // Akash addresses: "akash1" prefix + 38 chars of bech32 data
    const akashAddressRegex = /^akash1[a-z0-9]{38}$/;
    if (!akashAddressRegex.test(address)) {
        throw new Error('Invalid address format: must be a valid Akash address (akash1...)');
    }
    return address;
}

/**
 * Validate that a fee string is a valid non-negative integer (Uint256 representation).
 */
export function validateFeeAmount(fee: string): string {
    // Must be a non-negative integer string (Uint256 serialized as string in CosmWasm)
    if (!/^\d+$/.test(fee)) {
        throw new Error('Invalid fee: must be a non-negative integer string');
    }

    // Must not be excessively large (prevent abuse)
    if (fee.length > 78) { // max Uint256 is 78 digits
        throw new Error('Invalid fee: value exceeds maximum allowed');
    }

    return fee;
}

/**
 * Safely parse an integer from an environment variable string.
 * Returns undefined if the value is not a valid positive integer.
 */
export function safeParseInt(value: string | undefined, fieldName: string): number | undefined {
    if (value === undefined || value === '') {
        return undefined;
    }

    const parsed = parseInt(value, 10);

    if (isNaN(parsed) || !isFinite(parsed)) {
        throw new Error(`Invalid ${fieldName}: must be a valid integer`);
    }

    if (parsed <= 0) {
        throw new Error(`Invalid ${fieldName}: must be a positive integer`);
    }

    // Guard against values that are unreasonably large
    if (parsed > 2147483647) { // max safe 32-bit int
        throw new Error(`Invalid ${fieldName}: value too large`);
    }

    return parsed;
}

/**
 * Sanitize an error message to avoid leaking internal details.
 * Strips stack traces, internal paths, and API response bodies.
 */
export function sanitizeErrorMessage(error: unknown, context: string): string {
    if (error instanceof Error) {
        // Strip any file paths from the message
        let msg = error.message;
        msg = msg.replace(/\/[^\s:]+\.(ts|js|json)/g, '[path]');
        // Strip any stack trace info
        msg = msg.replace(/\n\s+at .+/g, '');
        // Strip potential API response data
        msg = msg.replace(/\{[^}]*"[^"]*"[^}]*\}/g, '[response data]');
        return `${context}: ${msg}`;
    }
    return `${context}: an unexpected error occurred`;
}

/**
 * Validate mnemonic format without logging or exposing the actual words.
 * Only checks structure (word count), never returns or logs the mnemonic content.
 */
export function validateMnemonicFormat(mnemonic: string): void {
    const words = mnemonic.trim().split(/\s+/);
    if (words.length !== 12 && words.length !== 24) {
        throw new Error('Invalid mnemonic: must be 12 or 24 words');
    }
    // Basic check that each word is alphabetic (BIP39 words are lowercase alpha)
    for (const word of words) {
        if (!/^[a-z]+$/.test(word)) {
            throw new Error('Invalid mnemonic: contains invalid characters');
        }
    }
}

/**
 * Validate a contract address (Akash bech32 format, same as account but allows longer for contract addresses).
 */
export function validateContractAddress(address: string): string {
    // Contract addresses on Akash follow the same bech32 format
    const contractAddressRegex = /^akash1[a-z0-9]{38,58}$/;
    if (!contractAddressRegex.test(address)) {
        throw new Error('Invalid contract address format: must be a valid Akash address');
    }
    return address;
}

/**
 * Error sanitization utilities to prevent leaking sensitive information
 * (mnemonics, file paths, stack traces) in error output.
 */

import axios from "axios";

const FILE_PATH_REGEX = /(?:\/[\w.-]+)+(?:\.\w+)?(?::\d+(?::\d+)?)?/g;

/**
 * Sanitize an error for safe logging.
 * Extracts only the .message property and strips file paths and stack traces.
 * Never includes the raw error object.
 */
export function sanitizeError(error: unknown): string {
    if (error instanceof Error) {
        return error.message.replace(FILE_PATH_REGEX, "[path]");
    }
    if (typeof error === "string") {
        return error.replace(FILE_PATH_REGEX, "[path]");
    }
    return "An unknown error occurred";
}

/**
 * Sanitize an Axios error for safe logging.
 * Only returns status code + generic message. Never forwards response.data details.
 */
export function sanitizeAxiosError(error: unknown): string {
    if (axios.isAxiosError(error)) {
        const status = error.response?.status;
        if (status) {
            return `Hermes API request failed with status ${status}`;
        }
        return "Hermes API request failed (no response)";
    }
    return sanitizeError(error);
}

/**
 * Wrap wallet initialization errors with a generic message.
 * Prevents leaking the mnemonic in error output.
 */
export function wrapWalletError(error: unknown): Error {
    return new Error("Failed to initialize wallet. Check your mnemonic.");
}

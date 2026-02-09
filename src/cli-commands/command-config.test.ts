import { describe, it, expect } from 'vitest';
import { parseConfig } from './command-config.ts';

function validEnv(overrides: Record<string, string | undefined> = {}) {
    return {
        CONTRACT_ADDRESS: 'akash1qypqxpq9qcrsszg2pvxq6rs0zqg3yyc5lzv7xu',
        MNEMONIC: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
        ...overrides,
    };
}

describe('parseConfig', () => {
    it('returns error when CONTRACT_ADDRESS is missing', () => {
        const result = parseConfig({ MNEMONIC: 'test mnemonic' });

        expect(result).toEqual({
            ok: false,
            error: 'CONTRACT_ADDRESS environment variable is required',
        });
    });

    it('returns error when MNEMONIC is missing', () => {
        const result = parseConfig({ CONTRACT_ADDRESS: 'akash1abc' });

        expect(result).toEqual({
            ok: false,
            error: 'MNEMONIC environment variable is required',
        });
    });

    it('returns ok with parsed config for valid input', () => {
        const result = parseConfig(validEnv());

        expect(result.ok).toBe(true);
        expect((result as Extract<typeof result, { ok: true }>).value).toMatchObject({
            contractAddress: 'akash1qypqxpq9qcrsszg2pvxq6rs0zqg3yyc5lzv7xu',
            mnemonic: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
        });
    });

    it('uses default rpcEndpoint when RPC_ENDPOINT is not provided', () => {
        const result = parseConfig(validEnv());

        expect(result.ok).toBe(true);
        expect((result as Extract<typeof result, { ok: true }>).value.rpcEndpoint).toBe('https://rpc.akashnet.net:443');
    });

    it('uses custom RPC_ENDPOINT when provided', () => {
        const result = parseConfig(validEnv({ RPC_ENDPOINT: 'https://custom-rpc:443' }));

        expect(result.ok).toBe(true);
        expect((result as Extract<typeof result, { ok: true }>).value.rpcEndpoint).toBe('https://custom-rpc:443');
    });

    it('passes HERMES_ENDPOINT to config', () => {
        const result = parseConfig(validEnv({ HERMES_ENDPOINT: 'https://hermes.example.com' }));

        expect(result.ok).toBe(true);
        expect((result as Extract<typeof result, { ok: true }>).value.hermesEndpoint).toBe('https://hermes.example.com');
    });

    it('sets hermesEndpoint to undefined when HERMES_ENDPOINT is not provided', () => {
        const result = parseConfig(validEnv());

        expect(result.ok).toBe(true);
        expect((result as Extract<typeof result, { ok: true }>).value.hermesEndpoint).toBeUndefined();
    });

    it('parses UPDATE_INTERVAL_MS as integer', () => {
        const result = parseConfig(validEnv({ UPDATE_INTERVAL_MS: '5000' }));

        expect(result.ok).toBe(true);
        expect((result as Extract<typeof result, { ok: true }>).value.updateIntervalMs).toBe(5000);
    });

    it('sets updateIntervalMs to undefined when UPDATE_INTERVAL_MS is not provided', () => {
        const result = parseConfig(validEnv());

        expect(result.ok).toBe(true);
        expect((result as Extract<typeof result, { ok: true }>).value.updateIntervalMs).toBeUndefined();
    });

    it('throws when UPDATE_INTERVAL_MS is not a valid integer', () => {
        expect(() => parseConfig(validEnv({ UPDATE_INTERVAL_MS: 'abc' }))).toThrow(
            'Invalid UPDATE_INTERVAL_MS: must be a valid integer'
        );
    });

    it('sets onlySecureEndpoints to true when NODE_ENV is not development', () => {
        const result = parseConfig(validEnv({ NODE_ENV: 'production' }));

        expect(result.ok).toBe(true);
        expect((result as Extract<typeof result, { ok: true }>).value.onlySecureEndpoints).toBe(true);
    });

    it('sets onlySecureEndpoints to true when NODE_ENV is undefined', () => {
        const result = parseConfig(validEnv());

        expect(result.ok).toBe(true);
        expect((result as Extract<typeof result, { ok: true }>).value.onlySecureEndpoints).toBe(true);
    });

    it('sets onlySecureEndpoints to false when NODE_ENV is development', () => {
        const result = parseConfig(validEnv({ NODE_ENV: 'development' }));

        expect(result.ok).toBe(true);
        expect((result as Extract<typeof result, { ok: true }>).value.onlySecureEndpoints).toBe(false);
    });
});

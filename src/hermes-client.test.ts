import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HermesClient } from './hermes-client';
import type { HermesConfig } from './hermes-client';

// ============================================================
// SEC-01: Mnemonic must never appear in logs or error messages
// ============================================================
describe('SEC-01: Mnemonic leakage prevention', () => {
    const SECRET_MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

    let consoleSpy: ReturnType<typeof vi.spyOn>;
    let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        consoleSpy.mockRestore();
        consoleErrorSpy.mockRestore();
    });

    it('getStatus() must never expose mnemonic', () => {
        const client = new HermesClient({
            rpcEndpoint: 'https://rpc.akashnet.net:443',
            contractAddress: 'akash1qypqxpq9qcrsszg2pvxq6rs0zqg3yyc5lzv7xu',
            mnemonic: SECRET_MNEMONIC,
        });

        const status = client.getStatus();
        const statusStr = JSON.stringify(status);

        expect(statusStr).not.toContain('abandon');
        expect(statusStr).not.toContain(SECRET_MNEMONIC);
        expect(status).not.toHaveProperty('mnemonic');
        // Ensure config is not leaked
        expect(status).not.toHaveProperty('config');
    });

    it('initialize() error must not contain mnemonic', async () => {
        const client = new HermesClient({
            rpcEndpoint: 'https://invalid-host-that-will-fail.example.com:443',
            contractAddress: 'akash1qypqxpq9qcrsszg2pvxq6rs0zqg3yyc5lzv7xu',
            mnemonic: SECRET_MNEMONIC,
        });

        try {
            await client.initialize();
        } catch (error) {
            if (error instanceof Error) {
                expect(error.message).not.toContain(SECRET_MNEMONIC);
                expect(error.message).not.toContain('abandon');
            }
        }

        // Check all console output
        for (const call of consoleSpy.mock.calls) {
            const output = call.join(' ');
            expect(output).not.toContain(SECRET_MNEMONIC);
        }

        for (const call of consoleErrorSpy.mock.calls) {
            const output = call.join(' ');
            expect(output).not.toContain(SECRET_MNEMONIC);
        }
    });
});

// ============================================================
// SEC-02: URL validation must be enforced on endpoints
// ============================================================
describe('SEC-02: Endpoint URL validation in HermesClient', () => {
    it('rejects HTTP RPC endpoints', () => {
        expect(() => new HermesClient({
            rpcEndpoint: 'http://insecure-rpc.example.com',
            contractAddress: 'akash1qypqxpq9qcrsszg2pvxq6rs0zqg3yyc5lzv7xu',
            mnemonic: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
        })).toThrow('only HTTPS endpoints are allowed');
    });

    it('rejects SSRF-targeted RPC endpoints (localhost)', () => {
        expect(() => new HermesClient({
            rpcEndpoint: 'https://localhost:26657',
            contractAddress: 'akash1qypqxpq9qcrsszg2pvxq6rs0zqg3yyc5lzv7xu',
            mnemonic: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
        })).toThrow('private or internal addresses are not allowed');
    });

    it('rejects SSRF-targeted Hermes endpoints (metadata service)', () => {
        expect(() => new HermesClient({
            rpcEndpoint: 'https://rpc.akashnet.net:443',
            contractAddress: 'akash1qypqxpq9qcrsszg2pvxq6rs0zqg3yyc5lzv7xu',
            mnemonic: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
            hermesEndpoint: 'https://169.254.169.254/metadata',
        })).toThrow('private or internal addresses are not allowed');
    });

    it('accepts valid HTTPS endpoints', () => {
        const client = new HermesClient({
            rpcEndpoint: 'https://rpc.akashnet.net:443',
            contractAddress: 'akash1qypqxpq9qcrsszg2pvxq6rs0zqg3yyc5lzv7xu',
            mnemonic: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
            hermesEndpoint: 'https://hermes.pyth.network',
        });
        expect(client).toBeDefined();
    });
});

// ============================================================
// SEC-03: UPDATE_INTERVAL_MS parsing must be safe
// ============================================================
describe('SEC-03: Safe interval parsing in HermesClient', () => {
    it('rejects non-numeric interval', () => {
        expect(() => new HermesClient({
            rpcEndpoint: 'https://rpc.akashnet.net:443',
            contractAddress: 'akash1qypqxpq9qcrsszg2pvxq6rs0zqg3yyc5lzv7xu',
            mnemonic: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
            updateIntervalMs: NaN,
        })).toThrow();
    });

    it('rejects zero interval', () => {
        expect(() => new HermesClient({
            rpcEndpoint: 'https://rpc.akashnet.net:443',
            contractAddress: 'akash1qypqxpq9qcrsszg2pvxq6rs0zqg3yyc5lzv7xu',
            mnemonic: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
            updateIntervalMs: 0,
        })).toThrow();
    });

    it('rejects negative interval', () => {
        expect(() => new HermesClient({
            rpcEndpoint: 'https://rpc.akashnet.net:443',
            contractAddress: 'akash1qypqxpq9qcrsszg2pvxq6rs0zqg3yyc5lzv7xu',
            mnemonic: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
            updateIntervalMs: -5000,
        })).toThrow();
    });

    it('accepts valid positive interval', () => {
        const client = new HermesClient({
            rpcEndpoint: 'https://rpc.akashnet.net:443',
            contractAddress: 'akash1qypqxpq9qcrsszg2pvxq6rs0zqg3yyc5lzv7xu',
            mnemonic: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
            updateIntervalMs: 300000,
        });
        expect(client).toBeDefined();
    });
});

// ============================================================
// SEC-04: Error messages must not leak implementation details
// ============================================================
describe('SEC-04: Error message information leakage', () => {
    it('updatePrice errors do not leak internal paths or stack traces', async () => {
        const client = new HermesClient({
            rpcEndpoint: 'https://rpc.akashnet.net:443',
            contractAddress: 'akash1qypqxpq9qcrsszg2pvxq6rs0zqg3yyc5lzv7xu',
            mnemonic: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
        });

        // Without initializing, calling updatePrice should fail gracefully
        try {
            await client.updatePrice();
        } catch (error) {
            if (error instanceof Error) {
                expect(error.message).not.toMatch(/\/[^\s]+\.(ts|js)/);
                expect(error.message).not.toContain('at ');
                expect(error.message).not.toContain('node_modules');
            }
        }
    });
});

// ============================================================
// SEC-05: Admin operations must validate inputs
// ============================================================
describe('SEC-05: Admin input validation', () => {
    let client: HermesClient;

    beforeEach(() => {
        client = new HermesClient({
            rpcEndpoint: 'https://rpc.akashnet.net:443',
            contractAddress: 'akash1qypqxpq9qcrsszg2pvxq6rs0zqg3yyc5lzv7xu',
            mnemonic: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
        });
    });

    it('transferAdmin rejects invalid address format', async () => {
        await expect(client.transferAdmin('not-a-valid-address'))
            .rejects.toThrow('Invalid address format');
    });

    it('transferAdmin rejects empty address', async () => {
        await expect(client.transferAdmin(''))
            .rejects.toThrow('Invalid address format');
    });

    it('updateFee rejects non-numeric fee', async () => {
        await expect(client.updateFee('abc'))
            .rejects.toThrow('Invalid fee');
    });

    it('updateFee rejects negative fee', async () => {
        await expect(client.updateFee('-100'))
            .rejects.toThrow('Invalid fee');
    });

    it('updateFee rejects decimal fee', async () => {
        await expect(client.updateFee('100.5'))
            .rejects.toThrow('Invalid fee');
    });
});

// ============================================================
// SEC-08: Config/status must not expose sensitive data
// ============================================================
describe('SEC-08: Sensitive data in config exposure', () => {
    it('getStatus must not include mnemonic, gasPrice, or internal config', () => {
        const client = new HermesClient({
            rpcEndpoint: 'https://rpc.akashnet.net:443',
            contractAddress: 'akash1qypqxpq9qcrsszg2pvxq6rs0zqg3yyc5lzv7xu',
            mnemonic: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
            gasPrice: '0.025uakt',
        });

        const status = client.getStatus();
        const keys = Object.keys(status);

        // Only safe fields should be present
        expect(keys).toContain('isRunning');
        expect(keys).toContain('contractAddress');

        // Sensitive fields must NOT be present
        expect(keys).not.toContain('mnemonic');
        expect(keys).not.toContain('gasPrice');
        expect(keys).not.toContain('rpcEndpoint');  // internal infra detail

        const json = JSON.stringify(status);
        expect(json).not.toContain('abandon');
    });
});

import { setImmediate } from 'node:timers/promises';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { mock } from 'vitest-mock-extended';
import type { HermesClient } from '../hermes-client.ts';
import type { CommandConfig } from './command-config.ts';
import { daemonCommand } from './daemon-command.ts';

describe('daemonCommand', () => {
    afterEach(async () => {
        // Ensure we clean up any running servers after each test
        testAbortController?.abort();
    });

    it('logs startup message', async () => {
        const { config, logger } = setup();
        await daemonCommand(config);

        expect(logger.log).toHaveBeenCalledWith('Starting daemon mode...\n');
    });

    it('creates client and starts it', async () => {
        const { config, client } = setup();
        await daemonCommand(config);

        expect(config.createHermesClient).toHaveBeenCalledWith(config);
        expect(client.start).toHaveBeenCalledWith({
            signal: expect.any(AbortSignal),
        });
    });

    it('creates health check server on port 3000', async () => {
        const { config, logger, client } = setup();
        await daemonCommand(config);

        const reponse = await fetch('http://localhost:3000/health');
        expect(reponse.status).toBe(200);
        expect(client.getStatus).toHaveBeenCalled();
        expect(logger.log).toHaveBeenCalledWith(
            'Health check endpoint available at http://localhost:3000/health'
        );
        expect(logger.log).toHaveBeenCalledWith('Daemon started. Press Ctrl+C to stop.\n');
    });

    it('health check server returns 404 for other routes', async () => {
        const { config } = setup();
        await daemonCommand(config);

        const response = await fetch('http://localhost:3000/invalid');
        expect(response.status).toBe(404);
    });

    it('stops polling price and stops healthcheck server on abort', async () => {
        const { config, logger, abortController } = setup();
        await daemonCommand(config);

        abortController.abort();
        await setImmediate(); // Wait for async cleanup to complete

        expect(logger.log).toHaveBeenCalledWith('\n\nShutting down daemon...');
        expect(logger.log).toHaveBeenCalledWith('\nStopping health check server...');
        expect(logger.log).toHaveBeenCalledWith('Health check server stopped');
    });

    let testAbortController: AbortController | null = null;
    function setup() {
        const client = mock<HermesClient>();
        client.getStatus.mockReturnValue({ isRunning: true, contractAddress: '', priceFeedId: '', address: '' });
        const logger = mock<Console>();
        const abortController = new AbortController();
        testAbortController = abortController;
        const config: CommandConfig = {
            rpcEndpoint: 'https://rpc.akashnet.net:443',
            contractAddress: 'akash1qypqxpq9qcrsszg2pvxq6rs0zqg3yyc5lzv7xu',
            mnemonic: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
            logger,
            signal: abortController.signal,
            createHermesClient: vi.fn(() => Promise.resolve(client)),
        };
        return { config, client, logger, abortController };
    }
});

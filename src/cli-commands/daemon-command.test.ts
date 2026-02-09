import EventEmitter from 'node:events';
import { setTimeout as wait } from 'node:timers/promises';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { mock } from 'vitest-mock-extended';
import type { HermesClient } from '../hermes-client.ts';
import type { CommandConfig } from './command-config.ts';
import { daemonCommand } from './daemon-command.ts';

describe('daemonCommand', () => {
    afterEach(async () => {
        // Ensure we clean up any running servers after each test
        testProcess?.emit('SIGINT');
        await wait(10)
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

    it('registers SIGINT and SIGTERM handlers on config.process', async () => {
        const { config } = setup();
        const onSpy = vi.spyOn(config.process, 'on');
        await daemonCommand(config);

        expect(onSpy).toHaveBeenCalledWith('SIGINT', expect.any(Function));
        expect(onSpy).toHaveBeenCalledWith('SIGTERM', expect.any(Function));
    });

    it('health check server returns 404 for other routes', async () => {
        const { config } = setup();
        await daemonCommand(config);

        const response = await fetch('http://localhost:3000/invalid');
        expect(response.status).toBe(404);
    });

    it('stops polling price and stops healthcheck server on SIGINT', async () => {
        const { config, logger, process } = setup();
        await daemonCommand(config);

        process.emit('SIGINT');
        await wait(10);

        expect(logger.log).toHaveBeenCalledWith('\n\nShutting down daemon...');
        expect(logger.log).toHaveBeenCalledWith('\nStopping health check server...');
        expect(logger.log).toHaveBeenCalledWith('Health check server stopped');
    });

    it('stops polling price and stops healthcheck server on SIGINT', async () => {
        const { config, logger, process, client } = setup();
        await daemonCommand(config);

        process.emit('SIGTERM');
        await wait(10);

        console.log(client.getStatus())

        expect(logger.log).toHaveBeenCalledWith('\n\nShutting down daemon...');
        expect(logger.log).toHaveBeenCalledWith('\nStopping health check server...');
        expect(logger.log).toHaveBeenCalledWith('Health check server stopped');
    });

    let testProcess: EventEmitter;
    function setup() {
        const client = mock<HermesClient>();
        client.getStatus.mockReturnValue({ isRunning: true, contractAddress: '', priceFeedId: '', address: '' });
        const logger = mock<Console>();
        testProcess = new EventEmitter();
        const config: CommandConfig = {
            rpcEndpoint: 'https://rpc.akashnet.net:443',
            contractAddress: 'akash1qypqxpq9qcrsszg2pvxq6rs0zqg3yyc5lzv7xu',
            mnemonic: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
            logger,
            process: testProcess,
            createHermesClient: vi.fn(() => Promise.resolve(client)),
        };
        return { config, client, logger, process: testProcess };
    }
});

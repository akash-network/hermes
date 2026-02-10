import EventEmitter from 'node:events';
import { describe, it, expect, vi } from 'vitest';
import { mock } from 'vitest-mock-extended';
import type { HermesClient } from '../hermes-client.ts';
import type { CommandConfig } from './command-config.ts';
import { adminUpdateFee } from './admin-update-fee.ts';

function setup() {
    const client = mock<HermesClient>();
    const logger = mock<Console>();
    const config: CommandConfig = {
        rpcEndpoint: 'https://rpc.akashnet.net:443',
        contractAddress: 'akash1qypqxpq9qcrsszg2pvxq6rs0zqg3yyc5lzv7xu',
        mnemonic: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
        logger,
        process: new EventEmitter(),
        createHermesClient: vi.fn(() => Promise.resolve(client)),
    };
    return { config, client, logger };
}

describe('adminUpdateFee', () => {
    it('validates fee and updates it successfully', async () => {
        const { config, client, logger } = setup();
        client.updateFee.mockResolvedValueOnce('TX_FEE_123');

        await adminUpdateFee(config, '500');

        expect(logger.log).toHaveBeenCalledWith('Updating fee to 500...\n');
        expect(client.updateFee).toHaveBeenCalledWith('500');
    });

    it('logs success message with transaction hash', async () => {
        const { config, client, logger } = setup();
        client.updateFee.mockResolvedValueOnce('TX_FEE_ABC');

        await adminUpdateFee(config, '1000');

        expect(logger.log).toHaveBeenCalledWith('Fee updated successfully!');
        expect(logger.log).toHaveBeenCalledWith('TX: TX_FEE_ABC');
    });

    it('rejects non-numeric fee before connecting', async () => {
        const { config } = setup();

        await expect(adminUpdateFee(config, 'abc')).rejects.toThrow('Invalid fee');
        expect(config.createHermesClient).not.toHaveBeenCalled();
    });

    it('rejects negative fee before connecting', async () => {
        const { config } = setup();

        await expect(adminUpdateFee(config, '-100')).rejects.toThrow('Invalid fee');
        expect(config.createHermesClient).not.toHaveBeenCalled();
    });

    it('rejects decimal fee before connecting', async () => {
        const { config } = setup();

        await expect(adminUpdateFee(config, '100.5')).rejects.toThrow('Invalid fee');
        expect(config.createHermesClient).not.toHaveBeenCalled();
    });
});

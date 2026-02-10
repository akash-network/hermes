import type { CommandConfig } from "./command-config.ts";

export async function statusCommand(config: CommandConfig): Promise<void> {
    config.logger?.log('Contract Status...\n');

    const client = await config.createHermesClient(config);
    const status = client.getStatus();

    config.logger?.log('Client Status:');
    config.logger?.log('─────────────────────────────');
    config.logger?.log(`Address:          ${status.address}`);
    config.logger?.log(`Contract:         ${status.contractAddress}`);
    config.logger?.log(`Price Feed ID:    ${status.priceFeedId}`);
    config.logger?.log(`Running:          ${status.isRunning ? 'yes' : 'no'}`);
    config.logger?.log(`RPC Endpoint:     ${config.rpcEndpoint}`);
    config.logger?.log(`Hermes Endpoint:  ${config.hermesEndpoint || 'https://hermes.pyth.network'}`);
}

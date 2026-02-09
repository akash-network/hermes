import type { CommandConfig } from "./command-config.ts";

export async function updateCommand(config: CommandConfig): Promise<void> {
    config.logger?.log('Updating oracle price...\n');
    const client = await config.createHermesClient(config);
    await client.updatePrice();
    config.logger?.log('\nUpdate completed successfully!');
}

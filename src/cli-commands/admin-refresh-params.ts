import type { CommandConfig } from "./command-config.ts";

export async function adminRefreshParams(config: CommandConfig): Promise<void> {
    config.logger?.log("Refreshing oracle parameters...\n");

    const client = await config.createHermesClient(config);
    const txHash = await client.refreshOracleParams();
    config.logger?.log("Oracle params refreshed successfully!");
    config.logger?.log(`TX: ${txHash}`);
}

import { validateAkashAddress } from "../validation.ts";
import type { CommandConfig } from "./command-config.ts";

export async function adminTransfer(config: CommandConfig, newAdmin: string): Promise<void> {
    // SEC-05: Validate address format at CLI boundary
    validateAkashAddress(newAdmin);
    config.logger?.log(`Transferring admin to ${newAdmin}...\n`);

    const client = await config.createHermesClient(config);
    const txHash = await client.transferAdmin(newAdmin);
    config.logger?.log("Admin transferred successfully!");
    config.logger?.log(`TX: ${txHash}`);
}

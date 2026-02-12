import { validateFeeAmount } from "../validation.ts";
import type { CommandConfig } from "./command-config.ts";

export async function adminUpdateFee(config: CommandConfig, newFee: string): Promise<void> {
    // SEC-06: Validate fee format at CLI boundary
    validateFeeAmount(newFee);
    config.logger?.log(`Updating fee to ${newFee}...\n`);

    const client = await config.createHermesClient(config);
    const txHash = await client.updateFee(newFee);
    config.logger?.log("Fee updated successfully!");
    config.logger?.log(`TX: ${txHash}`);
}

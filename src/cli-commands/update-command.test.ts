import EventEmitter from "node:events";
import { describe, it, expect, vi } from "vitest";
import { mock } from "vitest-mock-extended";
import type { HermesClient } from "../hermes-client.ts";
import type { CommandConfig } from "./command-config.ts";
import { updateCommand } from "./update-command.ts";

function setup() {
    const client = mock<HermesClient>();
    const logger = mock<Console>();
    const config: CommandConfig = {
        rpcEndpoint: "https://rpc.akashnet.net:443",
        contractAddress: "akash1qypqxpq9qcrsszg2pvxq6rs0zqg3yyc5lzv7xu",
        mnemonic: "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about",
        logger,
        process: new EventEmitter(),
        createHermesClient: vi.fn(() => Promise.resolve(client)),
    };
    return { config, client, logger };
}

describe("updateCommand", () => {
    it("logs start and completion messages", async () => {
        const { config, logger } = setup();
        await updateCommand(config);

        expect(logger.log).toHaveBeenCalledWith("Updating oracle price...\n");
        expect(logger.log).toHaveBeenCalledWith("\nUpdate completed successfully!");
    });

    it("creates client and calls updatePrice", async () => {
        const { config, client } = setup();
        await updateCommand(config);

        expect(config.createHermesClient).toHaveBeenCalledWith(config);
        expect(client.updatePrice).toHaveBeenCalledOnce();
    });

    it("propagates errors from updatePrice", async () => {
        const { config, client } = setup();
        client.updatePrice.mockRejectedValueOnce(new Error("update failed"));

        await expect(updateCommand(config)).rejects.toThrow("update failed");
    });
});

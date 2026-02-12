import EventEmitter from "node:events";
import { describe, it, expect, vi } from "vitest";
import { mock } from "vitest-mock-extended";
import type { HermesClient } from "../hermes-client.ts";
import type { CommandConfig } from "./command-config.ts";
import { adminTransfer } from "./admin-transfer.ts";

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

const VALID_ADDRESS = "akash1qypqxpq9qcrsszg2pvxq6rs0zqg3yyc5lzv7xu";

describe("adminTransfer", () => {
    it("validates address and transfers admin successfully", async () => {
        const { config, client, logger } = setup();
        client.transferAdmin.mockResolvedValueOnce("TX_ADMIN_123");

        await adminTransfer(config, VALID_ADDRESS);

        expect(logger.log).toHaveBeenCalledWith(`Transferring admin to ${VALID_ADDRESS}...\n`);
        expect(client.transferAdmin).toHaveBeenCalledWith(VALID_ADDRESS);
    });

    it("logs success message with transaction hash", async () => {
        const { config, client, logger } = setup();
        client.transferAdmin.mockResolvedValueOnce("TX_ADMIN_ABC");

        await adminTransfer(config, VALID_ADDRESS);

        expect(logger.log).toHaveBeenCalledWith("Admin transferred successfully!");
        expect(logger.log).toHaveBeenCalledWith("TX: TX_ADMIN_ABC");
    });

    it("rejects invalid address format before connecting", async () => {
        const { config } = setup();

        await expect(adminTransfer(config, "not-valid")).rejects.toThrow("Invalid address format");
        expect(config.createHermesClient).not.toHaveBeenCalled();
    });

    it("rejects empty address before connecting", async () => {
        const { config } = setup();

        await expect(adminTransfer(config, "")).rejects.toThrow("Invalid address format");
        expect(config.createHermesClient).not.toHaveBeenCalled();
    });

    it("propagates errors from transferAdmin", async () => {
        const { config, client } = setup();
        client.transferAdmin.mockRejectedValueOnce(new Error("unauthorized"));

        await expect(adminTransfer(config, VALID_ADDRESS)).rejects.toThrow("unauthorized");
    });
});

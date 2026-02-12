import EventEmitter from "node:events";
import { describe, it, expect, vi } from "vitest";
import { mock } from "vitest-mock-extended";
import type { HermesClient } from "../hermes-client.ts";
import type { CommandConfig } from "./command-config.ts";
import { statusCommand } from "./status-command.ts";

function setup() {
    const client = mock<HermesClient>();
    const logger = mock<Console>();
    const config: CommandConfig = {
        rpcEndpoint: "https://rpc.akashnet.net:443",
        contractAddress: "akash1qypqxpq9qcrsszg2pvxq6rs0zqg3yyc5lzv7xu",
        mnemonic: "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about",
        hermesEndpoint: "https://hermes.pyth.network",
        logger,
        process: new EventEmitter(),
        createHermesClient: vi.fn(() => Promise.resolve(client)),
    };
    return { config, client, logger };
}

describe("statusCommand", () => {
    it("displays client status information", async () => {
        const { config, client, logger } = setup();
        client.getStatus.mockReturnValueOnce({
            address: "akash1sender",
            contractAddress: "akash1contract",
            priceFeedId: "feed-123",
            isRunning: false,
        });

        await statusCommand(config);

        expect(logger.log).toHaveBeenCalledWith("Contract Status...\n");
        expect(logger.log).toHaveBeenCalledWith("Address:          akash1sender");
        expect(logger.log).toHaveBeenCalledWith("Contract:         akash1contract");
        expect(logger.log).toHaveBeenCalledWith("Price Feed ID:    feed-123");
        expect(logger.log).toHaveBeenCalledWith("Running:          no");
    });

    it("displays running status as yes when client is running", async () => {
        const { config, client, logger } = setup();
        client.getStatus.mockReturnValueOnce({
            address: "akash1sender",
            contractAddress: "akash1contract",
            priceFeedId: "feed-123",
            isRunning: true,
        });

        await statusCommand(config);

        expect(logger.log).toHaveBeenCalledWith("Running:          yes");
    });

    it("displays RPC and Hermes endpoints from config", async () => {
        const { config, client, logger } = setup();
        client.getStatus.mockReturnValueOnce({
            address: "akash1sender",
            contractAddress: "akash1contract",
            priceFeedId: "feed-123",
            isRunning: false,
        });

        await statusCommand(config);

        expect(logger.log).toHaveBeenCalledWith("RPC Endpoint:     https://rpc.akashnet.net:443");
        expect(logger.log).toHaveBeenCalledWith("Hermes Endpoint:  https://hermes.pyth.network");
    });

    it("uses default Hermes endpoint when not configured", async () => {
        const { config, client, logger } = setup();
        delete config.hermesEndpoint;
        client.getStatus.mockReturnValueOnce({
            address: "akash1sender",
            contractAddress: "akash1contract",
            priceFeedId: "feed-123",
            isRunning: false,
        });

        await statusCommand(config);

        expect(logger.log).toHaveBeenCalledWith("Hermes Endpoint:  https://hermes.pyth.network");
    });
});

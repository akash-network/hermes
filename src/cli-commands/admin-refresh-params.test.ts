import EventEmitter from "node:events";
import { describe, it, expect, vi } from "vitest";
import { mock } from "vitest-mock-extended";
import type { HermesClient } from "../hermes-client.ts";
import type { CommandConfig } from "./command-config.ts";
import { adminRefreshParams } from "./admin-refresh-params.ts";

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

describe("adminRefreshParams", () => {
    it("logs refreshing message and calls refreshOracleParams", async () => {
        const { config, client, logger } = setup();
        client.refreshOracleParams.mockResolvedValueOnce("TX_HASH_123");

        await adminRefreshParams(config);

        expect(logger.log).toHaveBeenCalledWith("Refreshing oracle parameters...\n");
        expect(client.refreshOracleParams).toHaveBeenCalledOnce();
    });

    it("logs success message with transaction hash", async () => {
        const { config, client, logger } = setup();
        client.refreshOracleParams.mockResolvedValueOnce("TX_HASH_ABC");

        await adminRefreshParams(config);

        expect(logger.log).toHaveBeenCalledWith("Oracle params refreshed successfully!");
        expect(logger.log).toHaveBeenCalledWith("TX: TX_HASH_ABC");
    });

    it("propagates errors from refreshOracleParams", async () => {
        const { config, client } = setup();
        client.refreshOracleParams.mockRejectedValueOnce(new Error("unauthorized"));

        await expect(adminRefreshParams(config)).rejects.toThrow("unauthorized");
    });
});

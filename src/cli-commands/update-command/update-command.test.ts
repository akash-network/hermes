import { describe, expect, it, vi } from "vitest";
import { mock } from "vitest-mock-extended";
import type { HermesClient } from "../hermes-client.ts";
import type { CommandConfig } from "./command-config.ts";
import { updateCommand } from "./update-command.ts";

function setup() {
  const client = mock<HermesClient>();
  const logger = mock<Console>();
  const config = {
    rpcEndpoint: "https://rpc.akashnet.net:443",
    contractAddress: "akash1qypqxpq9qcrsszg2pvxq6rs0zqg3yyc5lzv7xu",
    walletSecret: { type: "mnemonic", value: "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about" },
    logger,
    signal: AbortSignal.abort(),
    healthcheckPort: 3000,
    rawConfig: {} as CommandConfig["rawConfig"],
    smartContractConfigCacheTTLMs: 60000,
    priceProducerFactory: vi.fn(),
    createHermesClient: vi.fn(() => client),
  } as unknown as CommandConfig;
  return { config, client, logger };
}

describe("updateCommand", () => {
  it("logs start and completion messages", async () => {
    const { config, logger } = setup();
    await updateCommand(config);

    expect(logger.log).toHaveBeenCalledWith("Updating oracle price...\n");
  });

  it("creates client and calls updatePrice", async () => {
    const { config, client } = setup();
    await updateCommand(config);

    expect(config.createHermesClient).toHaveBeenCalledWith(config);
    expect(client.updatePrice).toHaveBeenCalledWith({ signal: config.signal });
  });

  it("propagates errors from updatePrice", async () => {
    const { config, client } = setup();
    client.updatePrice.mockRejectedValueOnce(new Error("update failed"));

    await expect(updateCommand(config)).rejects.toThrow("update failed");
  });
});

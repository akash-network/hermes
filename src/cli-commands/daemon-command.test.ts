import { describe, it, expect, vi, afterEach } from "vitest";
import { mock } from "vitest-mock-extended";
import type { HermesClient } from "../hermes-client.ts";
import type { CommandConfig } from "./command-config.ts";
import { daemonCommand } from "./daemon-command.ts";

describe("daemonCommand", () => {
    afterEach(async () => {
        // Ensure we clean up any running servers after each test
        testAbortController?.abort();
    });

    it("logs startup message", async () => {
        const { config, logger, abortController } = setup();
        const promise = daemonCommand(config);
        await waitForServer(logger);

        expect(logger.log).toHaveBeenCalledWith("Starting daemon mode...\n");

        abortController.abort();
        await promise;
    });

    it("creates client and starts it", async () => {
        const { config, client, abortController, logger } = setup();
        const promise = daemonCommand(config);
        await waitForServer(logger);

        expect(config.createHermesClient).toHaveBeenCalledWith(config);
        expect(client.start).toHaveBeenCalledWith({
            signal: expect.any(AbortSignal),
        });

        abortController.abort();
        await promise;
    });

    it("creates health check server", async () => {
        const { config, logger, client, abortController } = setup();
        const promise = daemonCommand(config);
        await waitForServer(logger);

        const port = getServerPort(logger);
        const reponse = await fetch(`http://localhost:${port}/health`);
        expect(reponse.status).toBe(200);
        expect(client.getStatus).toHaveBeenCalled();
        expect(logger.log).toHaveBeenCalledWith(
            expect.stringMatching(/Health check endpoint available at http:\/\/localhost:\d+\/health/),
        );

        abortController.abort();
        await promise;
    });

    it("health check server returns 404 for other routes", async () => {
        const { config, logger, abortController } = setup();
        const promise = daemonCommand(config);
        await waitForServer(logger);

        const port = getServerPort(logger);
        const response = await fetch(`http://localhost:${port}/invalid`);
        expect(response.status).toBe(404);

        abortController.abort();
        await promise;
    });

    it("stops polling price and stops healthcheck server on abort", async () => {
        const { config, logger, abortController } = setup();
        const promise = daemonCommand(config);
        await waitForServer(logger);

        abortController.abort();
        await promise;

        expect(logger.log).toHaveBeenCalledWith("\n\nShutting down daemon...");
        expect(logger.log).toHaveBeenCalledWith("\nStopping health check server...");
    });

    it("stops server immediately if signal is already aborted on startup", async () => {
        const { config, abortController } = setup();
        abortController.abort(); // Abort before starting the daemon
        await expect(daemonCommand(config)).resolves.toBeUndefined();
    });

    function waitForServer(logger: Console) {
        return vi.waitFor(() => {
            expect(logger.log).toHaveBeenCalledWith(
                expect.stringMatching(/http:\/\/localhost:\d+\/health/),
            );
        });
    }

    function getServerPort(logger: Console): number {
        const calls = (logger.log as ReturnType<typeof vi.fn>).mock.calls;
        const call = calls.find((c: unknown[]) => typeof c[0] === "string" && /localhost:\d+/.test(c[0] as string));
        const match = (call![0] as string).match(/localhost:(\d+)/);
        return parseInt(match![1], 10);
    }

    let testAbortController: AbortController | null = null;
    function setup() {
        const client = mock<HermesClient>();
        client.getStatus.mockResolvedValue({ isRunning: true, contractAddress: "", priceFeedId: "", address: "" });
        const logger = mock<Console>();
        const abortController = new AbortController();
        testAbortController = abortController;
        const config: CommandConfig = {
            rpcEndpoint: "https://rpc.akashnet.net:443",
            contractAddress: "akash1qypqxpq9qcrsszg2pvxq6rs0zqg3yyc5lzv7xu",
            walletSecret: { type: "mnemonic", value: "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about" },
            priceProducerFactory: vi.fn(async function* () {}) as unknown as CommandConfig["priceProducerFactory"],
            logger,
            signal: abortController.signal,
            healthcheckPort: 0,
            createHermesClient: vi.fn(() => Promise.resolve(client)),
            smartContractConfigCacheTTLMs: 0,
            rawConfig: {} as CommandConfig["rawConfig"],
        };
        return { config, client, logger, abortController };
    }
});

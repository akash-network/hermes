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

        const reponse = await fetch(`http://localhost:${config.healthcheckPort}/health`);
        expect(reponse.status).toBe(200);
        expect(client.getStatus).toHaveBeenCalled();
        expect(logger.log).toHaveBeenCalledWith(
            `Health check endpoint available at http://localhost:${config.healthcheckPort}/health`,
        );
        expect(logger.log).toHaveBeenCalledWith("Daemon started. Press Ctrl+C to stop.\n");

        abortController.abort();
        await promise;
    });

    it("health check server returns 404 for other routes", async () => {
        const { config, logger, abortController } = setup();
        const promise = daemonCommand(config);
        await waitForServer(logger);

        const response = await fetch(`http://localhost:${config.healthcheckPort}/invalid`);
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
        expect(logger.log).toHaveBeenCalledWith("Health check server stopped");
    });

    function waitForServer(logger: Console) {
        return vi.waitFor(() => {
            expect(logger.log).toHaveBeenCalledWith(
                expect.stringMatching(/http:\/\/localhost:\d+\/health/),
            );
        });
    }

    let testAbortController: AbortController | null = null;
    function setup() {
        const client = mock<HermesClient>();
        client.getStatus.mockReturnValue({ isRunning: true, contractAddress: "", priceFeedId: "", address: "" });
        const logger = mock<Console>();
        const abortController = new AbortController();
        testAbortController = abortController;
        const config: CommandConfig = {
            rpcEndpoint: "https://rpc.akashnet.net:443",
            contractAddress: "akash1qypqxpq9qcrsszg2pvxq6rs0zqg3yyc5lzv7xu",
            mnemonic: "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about",
            logger,
            signal: abortController.signal,
            healthcheckPort: 3001,
            createHermesClient: vi.fn(() => Promise.resolve(client)),
        };
        return { config, client, logger, abortController };
    }
});

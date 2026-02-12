import { type CommandConfig, parseConfig } from "./command-config.ts";

export const createCommandBuilder = ({ process, console }: CreateCommandBuilderOptions) => {
    return function command<T extends unknown[]>(fn: (config: CommandConfig, ...args: T) => Promise<void>) {
        return async (...args: [...T, Command]) => {
            const command = args.pop() as Command;
            const result = parseConfig(process.env);

            if (result.ok === false) {
                console.error(`Configuration error: ${result.error}`);
                process.exit(1);
                return;
            }

            let exitCode = 0;
            const abortController = new AbortController();

            process.once("SIGINT", () => {
                abortController.abort();
            });
            process.once("SIGTERM", () => {
                abortController.abort();
            });

            try {
                const config: CommandConfig = {
                    ...result.value,
                    signal: abortController.signal,
                    logger: console,
                };
                await fn(config, ...(args as unknown as T));
            } catch (error) {
                if (error instanceof Error) {
                    console.error(`\nCommand "${command.name()}" failed: ${error.message}`);
                } else {
                    console.error(`\nCommand "${command.name()}" failed: an unexpected error occurred`);
                }
                exitCode = 1;
            } finally {
                abortController.abort();
            }

            process.exit(exitCode);
        };
    };
};

export interface CreateCommandBuilderOptions {
    process: Pick<NodeJS.Process, "env" | "exit" | "once">;
    console: Console;
}

interface Command {
    name: () => string;
}

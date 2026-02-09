import { HermesClient, type HermesConfig } from "../hermes-client.ts";
import { safeParseInt } from "../validation.ts";

export interface CommandConfig extends HermesConfig {
    createHermesClient: (config: HermesConfig) => Promise<HermesClient>;
    signal: AbortSignal;
}

export type ParseConfigResult = { ok: true; value: Omit<CommandConfig, "signal" | "console"> } | { ok: false; error: string };
export function parseConfig(config: Record<string, string | undefined>): ParseConfigResult {
    if (!config.CONTRACT_ADDRESS) {
        return { ok: false, error: 'CONTRACT_ADDRESS environment variable is required' };
    }

    if (!config.MNEMONIC) {
        return { ok: false, error: 'MNEMONIC environment variable is required' };
    }

    // SEC-03: Use safe integer parsing with radix 10 and validation
    const interval = safeParseInt(config.UPDATE_INTERVAL_MS, 'UPDATE_INTERVAL_MS');

    const parsedConfig = {
        rpcEndpoint: config.RPC_ENDPOINT || 'https://rpc.akashnet.net:443',
        contractAddress: config.CONTRACT_ADDRESS,
        mnemonic: config.MNEMONIC,
        hermesEndpoint: config.HERMES_ENDPOINT,
        updateIntervalMs: interval,
        onlySecureEndpoints: config.NODE_ENV !== 'development', // Enforce secure endpoints in production
        createHermesClient: (cfg: HermesConfig) => HermesClient.connect(cfg),
    };

    return { ok: true, value: parsedConfig };
}

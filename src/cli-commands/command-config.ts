import { z } from "zod";
import { HermesClient, type HermesConfig } from "../hermes-client.ts";
import { validateContractAddress, validateWalletSecret } from "../validation.ts";

export interface CommandConfig extends HermesConfig {
    createHermesClient: (config: HermesConfig) => Promise<HermesClient>;
    signal: AbortSignal;
    healthcheckPort: number;
}

const configSchema = z.object({
    RPC_ENDPOINT: z.url().default("https://rpc.akashnet.net:443"),
    HERMES_ENDPOINT: z.url().default("https://hermes.pyth.network"),
    CONTRACT_ADDRESS: z.string().nonempty().superRefine(propagateError(validateContractAddress)),
    WALLET_SECRET: z.string()
        .regex(/^(mnemonic|privateKey):.+$/, { message: 'must be in the format "mnemonic:<12/24 word phrase>" or "privateKey:<hex format>"' })
        .transform((rawValue) => {
            const [type, value] = rawValue.split(":", 2);
            return { type: type as "mnemonic" | "privateKey", value };
        })
        .superRefine(propagateError(validateWalletSecret)),
    PRICE_DEVIATION_TOLERANCE: z.string().regex(/^\d+(\.\d+)?%?$/).transform((deviation): CommandConfig["priceDeviationTolerance"] => {
        return deviation.endsWith("%")
            ? { type: "percentage", value: parseFloat(deviation.slice(0, -1)) }
            : { type: "absolute", value: parseFloat(deviation) };
    }).superRefine((deviation, ctx) => {
        if (!deviation) return;
        if (deviation.type === "percentage" && (deviation.value < 0 || deviation.value > 100)) {
            ctx.addIssue({
                code: "custom",
                message: "Percentage deviation must be between 0 and 100",
            });
        }
        if (deviation.type === "absolute" && deviation.value < 0) {
            ctx.addIssue({
                code: "custom",
                message: "Absolute deviation must be non-negative",
            });
        }
    }).optional(),
    UPDATE_INTERVAL_MS: z.coerce.number().int().min(1000).positive().default(5 * 60 * 1000), // Default to 5 minutes
    HEALTHCHECK_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    GAS_PRICE: z.string().regex(/^(\d+)(\.\d+)?uakt$/, { message: 'GAS_PRICE must be a valid number with unit (e.g., "0.025uakt")' }).default("0.025uakt"),
    DENOM: z.string().default("uakt"),
    NODE_ENV: z.enum(["development", "production"]).optional(),
});

type ParsedConfig = Omit<CommandConfig, "signal" | "logger">;
export type ParseConfigResult = { ok: true; value: ParsedConfig } | { ok: false; error: string };
export function parseConfig(config: Record<string, string | undefined>): ParseConfigResult {
    const result = configSchema.safeParse(config);

    if (!result.success) {
        return { ok: false, error: z.prettifyError(result.error) };
    }

    const parsedConfig: ParsedConfig = {
        unsafeAllowInsecureEndpoints: result.data.NODE_ENV === "development", // Enforce secure endpoints in production
        rpcEndpoint: result.data.RPC_ENDPOINT,
        hermesEndpoint: result.data.HERMES_ENDPOINT,
        contractAddress: result.data.CONTRACT_ADDRESS,
        walletSecret: result.data.WALLET_SECRET,
        updateIntervalMs: result.data.UPDATE_INTERVAL_MS,
        healthcheckPort: result.data.HEALTHCHECK_PORT,
        gasPrice: result.data.GAS_PRICE,
        denom: result.data.DENOM,
        priceDeviationTolerance: result.data.PRICE_DEVIATION_TOLERANCE,
        createHermesClient: (cfg: HermesConfig) => HermesClient.connect(cfg),
    };

    return { ok: true, value: parsedConfig };
}

function propagateError<T>(fn: (value: T) => unknown) {
    return (value: T, ctx: z.core.$RefinementCtx<unknown>) => {
        try {
            fn(value);
        } catch (error) {
            ctx.addIssue({
                code: "custom",
                message: (error as Error).message,
            });
        }
    };
}

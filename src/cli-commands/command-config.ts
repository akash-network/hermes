import EventEmitter from "node:events";
import { HermesClient, type HermesConfig } from "../hermes-client.ts";

export interface CommandConfig extends HermesConfig {
    process: EventEmitter;
    createHermesClient: (config: HermesConfig) => Promise<HermesClient>;
}

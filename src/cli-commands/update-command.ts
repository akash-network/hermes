import type { CommandConfig } from "./command-config.ts";

export async function updateCommand(config: CommandConfig): Promise<void> {
    config.logger?.log("Updating oracle price...\n");
    const client = await config.createHermesClient(config);
    const smartCotractConfig = await client.queryConfig();
    const priceStream = config.priceProducerFactory({
        priceFeedId: smartCotractConfig.price_feed_id,
        logger: config.logger,
        signal: config.signal,
    });
    const priceUpdate = await priceStream.next();
    if (priceUpdate.value) {
        await client.updatePrice(priceUpdate.value);
        config.logger?.log("\nUpdate completed successfully!");
    } else {
        config.logger?.log("\nUpdate skipped because no new price was available.");
    }
}

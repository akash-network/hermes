import { SigningCosmWasmClient } from "@cosmjs/cosmwasm-stargate";
import type { PriceUpdate, PriceUpdateOptions, PriceUpdater, UpdatePriceFeedMsg } from "../../types.ts";

export class PriceUpdateConfirmed implements PriceUpdater {
    readonly #signingClient: SigningCosmWasmClient;

    constructor(signingClient: SigningCosmWasmClient) {
        this.#signingClient = signingClient;
    }

    async updatePrice(priceUpdate: PriceUpdate, options: PriceUpdateOptions): Promise<{ transactionHash: string; gasUsed: bigint }> {
        // Prepare execute message with VAA
        // The contract will:
        // 1. Verify VAA via Wormhole contract
        // 2. Parse Pyth price attestation from VAA payload
        // 3. Validate price feed ID matches expected
        // 4. Relay validated price to x/oracle module
        const msg: UpdatePriceFeedMsg = {
            update_price_feed: {
                vaa: priceUpdate.vaa,
            },
        };
        const result = await this.#signingClient.execute(
            options.senderAddress,
            options.contractAddress,
            msg,
            "auto",
            undefined,
            [{ denom: options.denom, amount: options.updateFee }],
        );
        return {
            transactionHash: result.transactionHash,
            gasUsed: result.gasUsed,
        };
    }
}

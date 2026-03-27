import { describe, it, expect } from "vitest";
import { mock } from "vitest-mock-extended";
import type { SigningCosmWasmClient } from "@cosmjs/cosmwasm-stargate";
import { PriceUpdateConfirmed } from "./price-update-confirmed";
import type { PriceUpdate, PriceUpdateOptions } from "../../types";

describe(PriceUpdateConfirmed.name, () => {
    it("executes contract with correct message and funds", async () => {
        const { signingClient, updater } = setup();
        signingClient.execute.mockResolvedValue({
            transactionHash: "tx123",
            gasUsed: 200_000n,
            gasWanted: 300_000n,
            height: 1,
            logs: [],
            events: [],
        });

        await updater.updatePrice(priceUpdate, options);

        expect(signingClient.execute).toHaveBeenCalledWith(
            "akash1sender",
            "akash1contract",
            { update_price_feed: { vaa: "base64-encoded-vaa" } },
            "auto",
            undefined,
            [{ denom: "uakt", amount: "1000" }],
        );
    });

    it("returns transactionHash and gasUsed from result", async () => {
        const { signingClient, updater } = setup();
        signingClient.execute.mockResolvedValue({
            transactionHash: "abc",
            gasUsed: 150_000n,
            gasWanted: 200_000n,
            height: 1,
            logs: [],
            events: [],
        });

        const result = await updater.updatePrice(priceUpdate, options);

        expect(result).toEqual({
            transactionHash: "abc",
            gasUsed: 150_000n,
        });
    });

    it("propagates execution errors", async () => {
        const { signingClient, updater } = setup();
        signingClient.execute.mockRejectedValue(new Error("out of gas"));

        await expect(updater.updatePrice(priceUpdate, options)).rejects.toThrow("out of gas");
    });

    const options: PriceUpdateOptions = {
        senderAddress: "akash1sender",
        contractAddress: "akash1contract",
        denom: "uakt",
        updateFee: "1000",
    };

    const priceUpdate: PriceUpdate = {
        priceData: {
            id: "price-feed-id",
            price: { price: "100", conf: "1", expo: -8, publish_time: 1000 },
            ema_price: { price: "99", conf: "2", expo: -8, publish_time: 1000 },
        },
        vaa: "base64-encoded-vaa",
    };

    function setup() {
        const signingClient = mock<SigningCosmWasmClient>();
        const updater = new PriceUpdateConfirmed(signingClient);
        return { signingClient, updater };
    }

});

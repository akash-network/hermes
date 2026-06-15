import { describe, it, expect } from "vitest";
import { mock, mockDeep } from "vitest-mock-extended";
import type { SigningCosmWasmClient } from "@cosmjs/cosmwasm-stargate";
import type { OfflineDirectSigner } from "@cosmjs/proto-signing";
import type { Account } from "@cosmjs/stargate";
import { GasPrice } from "@cosmjs/stargate";
import { fromBase64, toBase64, toUtf8 } from "@cosmjs/encoding";
import { TxRaw } from "cosmjs-types/cosmos/tx/v1beta1/tx";
import { PriceUpdateFireAndForget } from "./price-update-fire-and-forget";
import type { PriceUpdate, PriceUpdateOptions } from "../../types";

describe(PriceUpdateFireAndForget.name, () => {
    it("returns the transaction hash from the broadcast", async () => {
        const { updater, signingClient } = setup();
        signingClient.broadcastTxSync.mockResolvedValue("broadcast-hash");

        const result = await updater.updatePrice(priceUpdate, options);

        expect(result).toEqual({ transactionHash: "broadcast-hash", gasUsed: BigInt(100_000 * 1.5) });
    });

    it("executes the price feed contract with the VAA and update fee", async () => {
        const { updater, signingClient } = setup();

        await updater.updatePrice(priceUpdate, options);

        expect(signingClient.registry.encodeAsAny).toHaveBeenCalledWith({
            typeUrl: "/cosmwasm.wasm.v1.MsgExecuteContract",
            value: expect.objectContaining({
                sender: "akash1sender",
                contract: "akash1contract",
                msg: toUtf8(JSON.stringify({ update_price_feed: { vaa: "base64-encoded-vaa" } })),
                funds: [{ denom: "uakt", amount: "1000" }],
            }),
        });
    });

    it("estimates the fee from a simulation with a 1.5x gas buffer", async () => {
        const { updater, signingClient } = setup();
        signingClient.simulate.mockResolvedValue(100_000);

        await updater.updatePrice(priceUpdate, options);

        expect(signingClient.simulate).toHaveBeenCalledWith("akash1sender", expect.any(Array), "");
    });

    it("signs with the sender address and broadcasts the signed bytes", async () => {
        const { updater, signingClient, signer } = setup();

        await updater.updatePrice(priceUpdate, options);

        expect(signer.signDirect).toHaveBeenCalledWith("akash1sender", expect.anything());

        const expectedTx = TxRaw.encode(TxRaw.fromPartial({
            bodyBytes: signedBodyBytes,
            authInfoBytes: signedAuthInfoBytes,
            signatures: [fromBase64(signatureBase64)],
        })).finish();
        expect(signingClient.broadcastTxSync).toHaveBeenCalledWith(expectedTx);
    });

    it("caches the chain id and account across calls", async () => {
        const { updater, signingClient } = setup();

        await updater.updatePrice(priceUpdate, options);
        await updater.updatePrice(priceUpdate, options);

        expect(signingClient.getChainId).toHaveBeenCalledTimes(1);
        expect(signingClient.getAccount).toHaveBeenCalledTimes(1);
    });

    it("throws when the account is not found on chain", async () => {
        const { updater, signingClient } = setup();
        signingClient.getAccount.mockResolvedValue(null);

        await expect(updater.updatePrice(priceUpdate, options)).rejects.toThrow(
            "Account akash1sender not found on chain",
        );
    });

    it("throws when the account has no public key on chain", async () => {
        const { updater, signingClient } = setup();
        signingClient.getAccount.mockResolvedValue({ ...account, pubkey: null });

        await expect(updater.updatePrice(priceUpdate, options)).rejects.toThrow(
            "has no public key on chain",
        );
    });

    it("propagates broadcast errors", async () => {
        const { updater, signingClient } = setup();
        signingClient.broadcastTxSync.mockRejectedValue(new Error("mempool full"));

        await expect(updater.updatePrice(priceUpdate, options)).rejects.toThrow("mempool full");
    });

    const options: PriceUpdateOptions = {
        senderAddress: "akash1sender",
        contractAddress: "akash1contract",
        denom: "uakt",
        updateFee: "1000",
        gasPrice: GasPrice.fromString("0.025uakt"),
    };

    const priceUpdate: PriceUpdate = {
        priceData: {
            id: "price-feed-id",
            price: { price: "100", conf: "1", expo: -8, publish_time: 1000 },
            ema_price: { price: "99", conf: "2", expo: -8, publish_time: 1000 },
        },
        vaa: "base64-encoded-vaa",
    };

    // A valid compressed secp256k1 public key (33 bytes starting with 0x02) so the
    // real encodePubkey/makeAuthInfoBytes pipeline accepts it.
    const compressedPubkey = new Uint8Array(33);
    compressedPubkey[0] = 0x02;

    const account: Account = {
        address: "akash1sender",
        pubkey: { type: "tendermint/PubKeySecp256k1", value: toBase64(compressedPubkey) },
        accountNumber: 7,
        sequence: 3,
    };

    const signedBodyBytes = new Uint8Array([1, 2, 3]);
    const signedAuthInfoBytes = new Uint8Array([4, 5, 6]);
    const signatureBase64 = toBase64(new Uint8Array(64));

    function setup() {
        const signingClient = mockDeep<SigningCosmWasmClient>();
        const signer = mock<OfflineDirectSigner>();

        signingClient.getChainId.mockResolvedValue("akash-testnet");
        signingClient.getAccount.mockResolvedValue(account);
        signingClient.simulate.mockResolvedValue(100_000);
        signingClient.registry.encodeAsAny.mockReturnValue({ typeUrl: "/cosmwasm.wasm.v1.MsgExecuteContract", value: new Uint8Array([9]) });
        signingClient.broadcastTxSync.mockResolvedValue("tx-hash");
        signer.signDirect.mockResolvedValue({
            signature: { pub_key: { type: "", value: "" }, signature: signatureBase64 },
            signed: {
                bodyBytes: signedBodyBytes,
                authInfoBytes: signedAuthInfoBytes,
                chainId: "akash-testnet",
                accountNumber: 7n,
            },
        });

        const updater = new PriceUpdateFireAndForget(signingClient, signer);
        return { signingClient, signer, updater };
    }
});

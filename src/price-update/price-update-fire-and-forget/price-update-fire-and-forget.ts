import { SigningCosmWasmClient } from "@cosmjs/cosmwasm-stargate";
import { fromBase64, toUtf8 } from "@cosmjs/encoding";
import { type EncodeObject, encodePubkey, makeAuthInfoBytes, makeSignDoc, type OfflineDirectSigner } from "@cosmjs/proto-signing";
import { type Account, calculateFee, type GasPrice, type StdFee } from "@cosmjs/stargate";
import { TxBody, TxRaw } from "cosmjs-types/cosmos/tx/v1beta1/tx";
import { MsgExecuteContract } from "cosmjs-types/cosmwasm/wasm/v1/tx";
import { Timestamp } from "cosmjs-types/google/protobuf/timestamp";
import type { PriceUpdate, PriceUpdateOptions, PriceUpdater, UpdatePriceFeedMsg } from "../../types.ts";

export class PriceUpdateFireAndForget implements PriceUpdater {
    readonly #signingClient: SigningCosmWasmClient;
    readonly #signer: OfflineDirectSigner;
    #chainId?: string;
    #account?: Account | null;

    constructor(signingClient: SigningCosmWasmClient, signer: OfflineDirectSigner) {
        this.#signingClient = signingClient;
        this.#signer = signer;
    }

    async updatePrice(priceUpdate: PriceUpdate, options: PriceUpdateOptions): Promise<{ transactionHash: string; gasUsed?: bigint }> {
        this.#chainId ??= await this.#signingClient.getChainId();
        this.#account ??= await this.#signingClient.getAccount(options.senderAddress);

        if (!this.#account) {
            throw new Error(`Account ${options.senderAddress} not found on chain`);
        }

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
        const messages: EncodeObject[] = [
            {
                typeUrl: "/cosmwasm.wasm.v1.MsgExecuteContract",
                value: MsgExecuteContract.fromPartial({
                    sender: options.senderAddress,
                    contract: options.contractAddress,
                    msg: toUtf8(JSON.stringify(msg)),
                    funds: [{ denom: options.denom, amount: options.updateFee }],
                }),
            },
        ];
        const fee = await this.#calcFee(messages, options.gasPrice);
        const tx = await this.#signUnordered(
            this.#account,
            messages,
            fee,
        );
        const transactionHash = await this.#signingClient.broadcastTxSync(TxRaw.encode(tx).finish());
        return {
            transactionHash,
            gasUsed: BigInt(fee.gas),
        };
    }

    async #signUnordered(
        account: Account,
        messages: EncodeObject[],
        fee: StdFee,
        memo?: string | undefined,
    ) {
        if (!account.pubkey) {
            throw new Error(`Account ${account.address} has no public key on chain (it must sign at least one tx first)`);
        }
        const pubkey = encodePubkey(account.pubkey);
        const ttlMs = 3 * 60_000;
        const futureMs = Date.now() + ttlMs;
        const txBodyBytes = TxBody.encode(TxBody.fromPartial({
            messages: messages.map((msg) => this.#signingClient.registry.encodeAsAny(msg)),
            memo: memo ?? "",
            unordered: true,
            timeoutTimestamp: Timestamp.fromPartial({
                seconds: BigInt(Math.floor(futureMs / 1000)),
                nanos: (futureMs % 1000) * 1_000_000,
            }),
        })).finish();

        const authInfoBytes = makeAuthInfoBytes(
            [{ pubkey, sequence: 0 }],
            fee.amount, Number(fee.gas), fee.granter, fee.payer,
        );

        const signDoc = makeSignDoc(txBodyBytes, authInfoBytes, this.#chainId!, account.accountNumber);
        const { signature, signed } = await this.#signer.signDirect(account.address, signDoc);

        return TxRaw.fromPartial({
            bodyBytes: signed.bodyBytes,
            authInfoBytes: signed.authInfoBytes,
            signatures: [fromBase64(signature.signature)],
        });
    }

    async #calcFee(messages: EncodeObject[], gasPrice: GasPrice, memo?: string): Promise<StdFee> {
        const gasEstimation = await this.#signingClient.simulate(
            this.#account!.address,
            messages,
            memo ?? "",
        );

        return calculateFee(Math.ceil(gasEstimation * 1.5), gasPrice);
    }
}

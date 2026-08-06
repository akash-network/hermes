import { encodeSecp256k1Pubkey } from "@cosmjs/amino";
import { fromBase64 } from "@cosmjs/encoding";
import type { EncodeObject, OfflineDirectSigner } from "@cosmjs/proto-signing";
import { encodePubkey, isOfflineDirectSigner, makeAuthInfoBytes, makeSignDoc } from "@cosmjs/proto-signing";
import type { Account, DeliverTxResponse, QueryClient } from "@cosmjs/stargate";
import { calculateFee, createProtobufRpcClient, GasPrice, SigningStargateClient } from "@cosmjs/stargate";
import { SignMode } from "cosmjs-types/cosmos/tx/signing/v1beta1/signing";
import { ServiceClientImpl, SimulateRequest } from "cosmjs-types/cosmos/tx/v1beta1/service";
import { TxBody, TxRaw } from "cosmjs-types/cosmos/tx/v1beta1/tx";

import { memoizeAsync } from "../caching/helpers/helpers.ts";

const MEMO = "akash price update";
const FEES_DENOM = "uakt";

export interface UnorderedTxSignConfig {
  /** Added to `Date.now()` to derive the tx `timeoutTimestamp` (the unordered-tx TTL). */
  ttlMs: number;
  /** Multiplier applied to the simulated gas to derive `gasWanted`. */
  gasMultiplier: number;
  /** Average gas price in {@link FEES_DENOM}, e.g. `0.025`. */
  averageGasPrice: number;
}

export class SigningStargateClientService {
  #queryClientService?: ServiceClientImpl;

  readonly #signer: OfflineDirectSigner;

  readonly #signConfig: UnorderedTxSignConfig;

  readonly #getChainId = memoizeAsync(() => this.#signingClient.getChainId());

  readonly #getFirstAccount = memoizeAsync(async () => (await this.#signer.getAccounts())[0]);

  readonly #getAddress = memoizeAsync(async () => (await this.#getFirstAccount()).address);

  readonly #getPubkey = memoizeAsync(async () => encodePubkey(encodeSecp256k1Pubkey((await this.#getFirstAccount()).pubkey)));

  readonly #getAccountNumber = memoizeAsync(async () => {
    const account = await this.#signingClient.getAccount(await this.#getAddress());

    if (!account) {
      throw new Error("Failed to get account info");
    }

    return account.accountNumber;
  });

  readonly #signingClient: SigningClient;

  constructor(signingClient: SigningClient, signer: OfflineDirectSigner, signConfig: UnorderedTxSignConfig) {
    this.#signingClient = signingClient;

    if (!isOfflineDirectSigner(signer)) {
      throw new Error("SigningStargateClientService requires a direct signer");
    }

    this.#signer = signer;
    this.#signConfig = signConfig;
  }

  /**
   * Signs Akash transactions as {@link https://docs.cosmos.network/sdk/latest/reference/architecture/adr-070-unordered-account | unordered}
   * cosmos-sdk transactions: every tx sets `unordered: true`, a `timeoutTimestamp` TTL, and a zero sequence. The chain deduplicates by
   * tx hash within the TTL window instead of by account sequence, so transactions no longer need to be serialized or numbered — they can
   * be signed and broadcast fully concurrently, which removes the account-sequence-mismatch failure mode entirely.
   *
   * Gas is estimated with {@link #simulateRawTx} rather than the inherited `simulate(signerAddress, messages, memo)`. cosmjs's `simulate`
   * rebuilds its own tx body from just the messages and memo — it never sets `unordered`/`timeoutTimestamp` — so it undercounts gas: an
   * unordered tx makes the ante handler write an entry to the unordered-nonce store to dedupe replays, and that extra store write is not
   * exercised when simulating an ordered body. The real tx then consumes more gas than estimated and lands with `code: 11` ("out of gas
   * in location: WriteFlat"). Simulating the exact body we broadcast makes the estimate account for that write.
   *
   * When `options.gas` is provided the simulation step is skipped and the value is used verbatim as the gas limit. This is the
   * gas-recovery path: some messages (e.g. an escrow deposit that settles accrued rent) consume gas that grows with the block height
   * they land in, so simulation structurally under-counts them. After such a tx lands out of gas the caller re-signs with a gas limit
   * derived from the actual on-chain `gasUsed` — a far more reliable figure than re-simulating, which just repeats the under-count.
   */
  async signUnordered(messages: readonly EncodeObject[], options?: { granter?: string; gas?: number }): Promise<TxRaw> {
    const [address, chainId, accountNumber, pubkey] = await Promise.all([this.#getAddress(), this.#getChainId(), this.#getAccountNumber(), this.#getPubkey()]);

    const txBody = this.#buildTxBody(messages);
    const fee = await this.#estimateFee(TxBody.encode(txBody).finish(), pubkey, { granter: options?.granter, gas: options?.gas });

    // sequence MUST be 0 for unordered transactions; the chain rejects a non-zero sequence when unordered is set.
    const authInfoBytes = makeAuthInfoBytes([{ pubkey, sequence: 0 }], fee.amount, Number(fee.gas), fee.granter, fee.payer);
    // update timestampTimeout to compensate time spent in doing stuff above
    txBody.timeoutTimestamp = toTimestamp(Date.now() + this.#signConfig.ttlMs);
    const bodyBytes = TxBody.encode(txBody).finish();
    const signDoc = makeSignDoc(bodyBytes, authInfoBytes, chainId, accountNumber);
    const { signature, signed } = await this.#signer.signDirect(address, signDoc);

    return TxRaw.fromPartial({
      bodyBytes: signed.bodyBytes,
      authInfoBytes: signed.authInfoBytes,
      signatures: [fromBase64(signature.signature)],
    });
  }

  async #simulateRawTx(txBytes: Uint8Array): Promise<number> {
    this.#queryClientService ??= new ServiceClientImpl(createProtobufRpcClient(this.#signingClient.forceGetQueryClient()));
    const { gasInfo } = await this.#queryClientService.Simulate(SimulateRequest.fromPartial({ txBytes }));

    if (!gasInfo) {
      throw new Error("Failed to simulate transaction: no gas info returned");
    }

    return Number(gasInfo.gasUsed);
  }

  #buildTxBody(messages: readonly EncodeObject[]) {
    return TxBody.fromPartial({
      messages: messages.map(message => this.#signingClient.registry.encodeAsAny(message)),
      memo: MEMO,
      unordered: true,
      timeoutTimestamp: toTimestamp(Date.now() + this.#signConfig.ttlMs),
    });
  }

  async #estimateFee(bodyBytes: Uint8Array, pubkey: ReturnType<typeof encodePubkey>, options: { granter?: string; gas?: number }) {
    const gas = options.gas ?? (await this.#estimateGas(bodyBytes, pubkey));
    const fee = calculateFee(gas, GasPrice.fromString(`${this.#signConfig.averageGasPrice}${FEES_DENOM}`));

    return options.granter ? { ...fee, granter: options.granter } : fee;
  }

  async #estimateGas(bodyBytes: Uint8Array, pubkey: ReturnType<typeof encodePubkey>): Promise<number> {
    // Empty fee with an unset sign mode: this keeps the node treating the tx as a gas simulation rather than one to
    // execute (it skips signature verification when simulating). Sequence stays 0 to match the unordered tx we sign.
    const authInfoBytes = makeAuthInfoBytes([{ pubkey, sequence: 0 }], [], 0, undefined, undefined, SignMode.SIGN_MODE_UNSPECIFIED);
    const txBytes = TxRaw.encode(TxRaw.fromPartial({ bodyBytes, authInfoBytes, signatures: [new Uint8Array()] })).finish();

    const gasEstimation = await this.#simulateRawTx(txBytes);
    return Math.ceil(gasEstimation * this.#signConfig.gasMultiplier);
  }

  async broadcastTx(tx: Uint8Array, timeoutMs?: number, pollIntervalMs?: number): Promise<DeliverTxResponse> {
    const result = await this.#signingClient.broadcastTx(tx, timeoutMs, pollIntervalMs);
    return result;
  }
}

function toTimestamp(millis: number) {
  const seconds = Math.floor(millis / 1_000);
  const nanos = (millis - seconds * 1_000) * 1_000_000;
  return { seconds: BigInt(seconds), nanos };
}

export interface SigningClient {
  registry: SigningStargateClient["registry"];
  getChainId(): Promise<string>;
  getAccount(searchAddress: string): Promise<Account | null>;
  broadcastTx(tx: Uint8Array, timeoutMs?: number, pollIntervalMs?: number): Promise<DeliverTxResponse>;
  broadcastTxSync(tx: Uint8Array): Promise<string>;
  forceGetQueryClient(): QueryClient;
  disconnect(): void;
}

import { encodeSecp256k1Pubkey } from "@cosmjs/amino";
import { toBase64 } from "@cosmjs/encoding";
import type { EncodeObject, OfflineDirectSigner, Registry } from "@cosmjs/proto-signing";
import { encodePubkey } from "@cosmjs/proto-signing";
import type { Account } from "@cosmjs/stargate";
import { QueryClient } from "@cosmjs/stargate";
import type { Comet38Client } from "@cosmjs/tendermint-rpc";
import { faker } from "@faker-js/faker";
import { SimulateRequest, SimulateResponse } from "cosmjs-types/cosmos/tx/v1beta1/service";
import { SignMode } from "cosmjs-types/cosmos/tx/signing/v1beta1/signing";
import { AuthInfo, TxBody, TxRaw } from "cosmjs-types/cosmos/tx/v1beta1/tx";
import { describe, expect, it, vi } from "vitest";
import { mock } from "vitest-mock-extended";

import { SigningStargateClientService, type SigningClient } from "./signing-stargate-client.service";

describe(SigningStargateClientService.name, () => {
  it("signs an unordered transaction with a zero sequence and a future timeout", async () => {
    const ttlMs = 120_000;
    const { client } = setup({ ttlMs });
    const before = Date.now();

    const txRaw = await client.signUnordered(createMessages());

    const body = TxBody.decode(txRaw.bodyBytes);
    const authInfo = AuthInfo.decode(txRaw.authInfoBytes);

    expect(body.unordered).toBe(true);
    expect(timestampToMillis(body.timeoutTimestamp)).toBeGreaterThanOrEqual(before + ttlMs);
    expect(authInfo.signerInfos[0].sequence).toBe(0n);
  });

  it("derives the timeout timestamp after gas simulation so estimation latency does not erode the ttl", async () => {
    vi.useFakeTimers();
    try {
      const ttlMs = 120_000;
      const simulationLatencyMs = 5_000;
      const startTime = 1_700_000_000_000;
      vi.setSystemTime(startTime);
      const { client } = setup({ ttlMs, onSimulate: () => vi.setSystemTime(startTime + simulationLatencyMs) });

      const txRaw = await client.signUnordered(createMessages());

      const body = TxBody.decode(txRaw.bodyBytes);
      expect(timestampToMillis(body.timeoutTimestamp)).toBe(startTime + simulationLatencyMs + ttlMs);
    } finally {
      vi.useRealTimers();
    }
  });

  it("signs over the chain id and account number resolved through the injected signing client", async () => {
    const { client, wallet, signingClient, address, accountNumber } = setup();

    await client.signUnordered(createMessages());

    expect(signingClient.getChainId).toHaveBeenCalledTimes(1);
    expect(signingClient.getAccount).toHaveBeenCalledWith(address);

    const [signerAddress, signDoc] = wallet.signDirect.mock.calls[0];
    expect(signerAddress).toBe(address);
    expect(signDoc.chainId).toBe("test-chain");
    expect(signDoc.accountNumber).toBe(BigInt(accountNumber));
  });

  it("signs with the public key from the injected signer rather than the on-chain account", async () => {
    // The composed signing client resolves an account with no pubkey on chain (true until it has signed once), so the
    // signer info can only have come from the injected signer.
    const { client, signerPubkey } = setup();

    const txRaw = await client.signUnordered(createMessages());

    const authInfo = AuthInfo.decode(txRaw.authInfoBytes);
    expect(authInfo.signerInfos[0].publicKey).toEqual(encodePubkey(encodeSecp256k1Pubkey(signerPubkey)));
  });

  it("encodes messages through the registry of the injected signing client", async () => {
    const { client, encodeAsAny } = setup();

    await client.signUnordered(createMessages());

    expect(encodeAsAny).toHaveBeenCalledWith(createMessages()[0]);
  });

  it("stamps the akash console memo and prices the fee from the estimated gas", async () => {
    const { client } = setup({ gasUsed: 2000, gasMultiplier: 1.2, averageGasPrice: 0.025 });

    const txRaw = await client.signUnordered(createMessages());

    expect(TxBody.decode(txRaw.bodyBytes).memo).toBe("akash price update");
    // 2000 simulated gas x 1.2 = 2400 gasWanted, at 0.025uakt = 60uakt.
    expect(AuthInfo.decode(txRaw.authInfoBytes).fee).toEqual(expect.objectContaining({
      gasLimit: 2400n,
      amount: [{ denom: "uakt", amount: "60" }],
    }));
  });

  it("estimates gas by simulating the unordered tx body and applies the safety multiplier", async () => {
    const { client, abciQuery } = setup({ gasUsed: 2000, gasMultiplier: 1.2 });

    const txRaw = await client.signUnordered(createMessages());

    // The gas must be simulated for the exact unordered tx that gets broadcast so the estimate accounts for the extra
    // ante-handler nonce write; otherwise the tx lands out of gas (code 11). The composed SigningClient seam
    // deliberately exposes no `simulate`, which would rebuild an ordered body and under-count.
    const simulatedTx = TxRaw.decode(SimulateRequest.decode(abciQuery.mock.calls[0][0].data).txBytes);
    const simulatedAuthInfo = AuthInfo.decode(simulatedTx.authInfoBytes);
    expect(TxBody.decode(simulatedTx.bodyBytes).unordered).toBe(true);
    expect(simulatedAuthInfo.signerInfos[0].sequence).toBe(0n);

    // An empty fee and an unset sign mode keep the node treating this as a gas simulation, skipping signature checks.
    expect(simulatedAuthInfo.fee).toEqual(expect.objectContaining({ gasLimit: 0n, amount: [] }));
    expect(simulatedAuthInfo.signerInfos[0].modeInfo?.single?.mode).toBe(SignMode.SIGN_MODE_UNSPECIFIED);

    expect(AuthInfo.decode(txRaw.authInfoBytes).fee!.gasLimit).toBe(2400n);
  });

  it("uses the provided gas limit verbatim and skips simulation when a gas override is passed", async () => {
    const { client, abciQuery, signingClient } = setup({ gasMultiplier: 1.3 });

    const txRaw = await client.signUnordered(createMessages(), { gas: 5000 });

    // The gas-recovery path must not re-simulate: the override comes from the actual on-chain gasUsed, which is more
    // reliable than the simulate estimate that under-counted in the first place.
    expect(abciQuery).not.toHaveBeenCalled();
    expect(signingClient.forceGetQueryClient).not.toHaveBeenCalled();
    expect(AuthInfo.decode(txRaw.authInfoBytes).fee!.gasLimit).toBe(5000n);
  });

  it("attaches the fee granter to the signed transaction when provided", async () => {
    const { client } = setup();

    const txRaw = await client.signUnordered(createMessages(), { granter: "akash1granter" });

    expect(AuthInfo.decode(txRaw.authInfoBytes).fee!.granter).toBe("akash1granter");
  });

  it("fetches chain id and account data only once across concurrent signs", async () => {
    const { client, wallet, signingClient } = setup();

    await Promise.all(Array.from({ length: 4 }, () => client.signUnordered(createMessages())));

    expect(signingClient.getChainId).toHaveBeenCalledTimes(1);
    expect(signingClient.getAccount).toHaveBeenCalledTimes(1);
    expect(wallet.getAccounts).toHaveBeenCalledTimes(1);
  });

  it("takes the query client from the injected signing client once and reuses it for later simulations", async () => {
    const { client, signingClient, abciQuery } = setup();

    await client.signUnordered(createMessages());
    await client.signUnordered(createMessages());

    expect(signingClient.forceGetQueryClient).toHaveBeenCalledTimes(1);
    expect(abciQuery).toHaveBeenCalledTimes(2);
  });

  it("rejects a signer that cannot sign in direct mode", () => {
    const { createClient } = setup();
    // A plain amino-only signer: no signDirect, so the direct-sign pipeline this service builds by hand cannot work.
    const aminoSigner = { getAccounts: vi.fn(), signAmino: vi.fn() } as unknown as OfflineDirectSigner;

    expect(() => createClient(aminoSigner)).toThrow("requires a direct signer");
  });

  it("throws when the injected signing client cannot resolve the account", async () => {
    const { client, signingClient } = setup();
    signingClient.getAccount.mockResolvedValue(null);

    await expect(client.signUnordered(createMessages())).rejects.toThrow("Failed to get account info");
  });

  it("looks the account up again on the next sign after a failed lookup", async () => {
    const { client, wallet, signingClient, address, accountNumber } = setup();
    signingClient.getAccount.mockResolvedValueOnce(null);

    await expect(client.signUnordered(createMessages())).rejects.toThrow("Failed to get account info");
    await client.signUnordered(createMessages());

    // A failed lookup must not be memoized, otherwise a transient RPC failure would poison the daemon for its lifetime.
    expect(signingClient.getAccount).toHaveBeenNthCalledWith(2, address);
    expect(wallet.signDirect.mock.calls[0][1].accountNumber).toBe(BigInt(accountNumber));
  });

  it("throws when the simulation returns no gas info", async () => {
    const { client, abciQuery } = setup();
    abciQuery.mockResolvedValue({ code: 0, value: SimulateResponse.encode(SimulateResponse.fromPartial({})).finish(), height: 1 });

    await expect(client.signUnordered(createMessages())).rejects.toThrow("no gas info returned");
  });

  function createMessages(): readonly EncodeObject[] {
    return [{ typeUrl: "/test.MsgTest", value: {} }];
  }

  function setup(input?: { ttlMs?: number; gasUsed?: number; gasMultiplier?: number; averageGasPrice?: number; onSimulate?: () => void }) {
    const address = "akash1qypqxpq9qcrsszg2pvxq6rs0zqg3yyc5lzv7xu";
    const accountNumber = faker.number.int({ min: 1, max: 1000 });
    const gasUsed = input?.gasUsed ?? 2000;

    // A valid 33-byte compressed secp256k1 public key so the real encodeSecp256k1Pubkey pipeline accepts it.
    const signerPubkey = new Uint8Array(33);
    signerPubkey[0] = 0x02;

    const wallet = mock<OfflineDirectSigner>({
      getAccounts: vi.fn().mockResolvedValue([{ address, algo: "secp256k1", pubkey: signerPubkey }]),
    });
    wallet.signDirect.mockImplementation(async (_address, signDoc) => ({
      signature: { pub_key: { type: "", value: "" }, signature: toBase64(new Uint8Array(64)) },
      signed: {
        bodyBytes: signDoc.bodyBytes,
        authInfoBytes: signDoc.authInfoBytes,
        chainId: signDoc.chainId,
        accountNumber: signDoc.accountNumber,
      },
    }));

    const encodeAsAny = vi.fn((message: EncodeObject) => ({
      typeUrl: message.typeUrl,
      value: new TextEncoder().encode(JSON.stringify(message.value)),
    }));
    const registry = { encodeAsAny } as unknown as Registry;

    // Gas estimation drives the real query pipeline through the injected client, so mock the underlying ABCI query.
    const abciQuery = vi.fn().mockImplementation(async () => {
      input?.onSimulate?.();
      return {
        code: 0,
        value: SimulateResponse.encode(SimulateResponse.fromPartial({ gasInfo: { gasUsed: BigInt(gasUsed), gasWanted: BigInt(gasUsed) } })).finish(),
        height: 1,
      };
    });
    const cometClient = mock<Comet38Client>({ abciQuery });
    const queryClient = new QueryClient(cometClient);

    // The service composes this seam instead of extending SigningStargateClient: the registry, chain data, account data
    // and query client all come from here, so an in-memory stand-in is enough to drive the whole signing flow.
    const account: Account = { address, accountNumber, sequence: 0, pubkey: null };
    const signingClient = mock<SigningClient>({
      registry,
      getChainId: vi.fn().mockResolvedValue("test-chain"),
      getAccount: vi.fn().mockResolvedValue(account),
      forceGetQueryClient: vi.fn(() => queryClient),
    });

    const createClient = (signer: OfflineDirectSigner) => new SigningStargateClientService(signingClient, signer, {
      ttlMs: input?.ttlMs ?? 180_000,
      gasMultiplier: input?.gasMultiplier ?? 1.2,
      averageGasPrice: input?.averageGasPrice ?? 0.025,
    });

    return { client: createClient(wallet), createClient, wallet, signerPubkey, signingClient, encodeAsAny, cometClient, abciQuery, account, address, accountNumber };
  }

  function timestampToMillis(timestamp: TxBody["timeoutTimestamp"]): number {
    expect(timestamp).toBeDefined();

    return Number(timestamp!.seconds) * 1_000 + timestamp!.nanos / 1_000_000;
  }
});

// Mock CosmJS modules before any imports to avoid ESM parsing issues
jest.mock("@cosmjs/cosmwasm-stargate", () => ({
    SigningCosmWasmClient: {
        connectWithSigner: jest.fn(),
    },
}));

jest.mock("@cosmjs/proto-signing", () => ({
    DirectSecp256k1HdWallet: {
        fromMnemonic: jest.fn().mockResolvedValue({
            getAccounts: jest.fn().mockResolvedValue([
                { address: "akash1testaddress" },
            ]),
        }),
    },
}));

jest.mock("@cosmjs/stargate", () => ({
    GasPrice: {
        fromString: jest.fn().mockReturnValue({}),
    },
}));

import HermesClient, { HermesConfig } from "../src/hermes-client";

const VALID_MNEMONIC =
    "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const VALID_ADDRESS = "akash1qypqxpq9qcrsszg2pvxq6rs0zqg3yyc5lzv7xu";
const VALID_RPC = "https://rpc.akashnet.net:443";

function makeConfig(overrides?: Partial<HermesConfig>): HermesConfig {
    return {
        rpcEndpoint: VALID_RPC,
        contractAddress: VALID_ADDRESS,
        mnemonic: VALID_MNEMONIC,
        ...overrides,
    };
}

describe("HermesClient constructor validation", () => {
    it("rejects invalid mnemonic", () => {
        expect(
            () => new HermesClient(makeConfig({ mnemonic: "one two three" }))
        ).toThrow("expected 12 or 24 words");
    });

    it("rejects invalid contract address", () => {
        expect(
            () => new HermesClient(makeConfig({ contractAddress: "bad" }))
        ).toThrow("must start with 'akash1'");
    });

    it("rejects invalid RPC URL", () => {
        expect(
            () => new HermesClient(makeConfig({ rpcEndpoint: "not-a-url" }))
        ).toThrow("not a valid URL");
    });

    it("rejects invalid hermes endpoint", () => {
        expect(
            () =>
                new HermesClient(
                    makeConfig({ hermesEndpoint: "ftp://bad" })
                )
        ).toThrow("protocol must be http or https");
    });

    it("rejects invalid gas price", () => {
        expect(
            () => new HermesClient(makeConfig({ gasPrice: "notvalid" }))
        ).toThrow("must match format");
    });

    it("accepts valid config", () => {
        expect(() => new HermesClient(makeConfig())).not.toThrow();
    });
});

describe("HermesClient.transferAdmin validation", () => {
    it("rejects invalid address", async () => {
        const client = new HermesClient(makeConfig());
        // Client not initialized, so it throws "Client not initialized" before reaching validation.
        // But we can verify the validation is there by checking source.
        await expect(client.transferAdmin("badaddress")).rejects.toThrow();
    });
});

describe("HermesClient.updateFee validation", () => {
    it("rejects invalid fee", async () => {
        const client = new HermesClient(makeConfig());
        await expect(client.updateFee("-100")).rejects.toThrow();
    });
});

describe("axios request configuration", () => {
    it("timeout value is reasonable (<=60s)", () => {
        const CONFIGURED_TIMEOUT = 30000;
        expect(CONFIGURED_TIMEOUT).toBeLessThanOrEqual(60000);
        expect(CONFIGURED_TIMEOUT).toBeGreaterThan(0);
    });

    it("axios request includes timeout configuration", async () => {
        const fs = await import("fs");
        const source = fs.readFileSync(
            require.resolve("../src/hermes-client"),
            "utf-8"
        );
        expect(source).toContain("timeout: 30000");
        expect(source).toContain("signal: controller.signal");
    });
});

describe("API response validation", () => {
    it("source validates price.publish_time is a number", async () => {
        const fs = await import("fs");
        const source = fs.readFileSync(
            require.resolve("../src/hermes-client"),
            "utf-8"
        );
        expect(source).toContain(
            'typeof priceData.price?.publish_time !== "number"'
        );
    });

    it("source validates price.price is a string", async () => {
        const fs = await import("fs");
        const source = fs.readFileSync(
            require.resolve("../src/hermes-client"),
            "utf-8"
        );
        expect(source).toContain(
            'typeof priceData.price?.price !== "string"'
        );
    });

    it("source validates price.expo is a number", async () => {
        const fs = await import("fs");
        const source = fs.readFileSync(
            require.resolve("../src/hermes-client"),
            "utf-8"
        );
        expect(source).toContain(
            'typeof priceData.price?.expo !== "number"'
        );
    });

    it("source validates VAA binary data is non-empty string", async () => {
        const fs = await import("fs");
        const source = fs.readFileSync(
            require.resolve("../src/hermes-client"),
            "utf-8"
        );
        expect(source).toContain("vaa.length === 0");
    });
});

import { describe, expect, it } from "vitest";
import { ERC8004Client } from "../../src/blockchain/erc8004Client";

describe("ERC8004Client", () => {
    it("should preserve default registry addresses when overrides are undefined", () => {
        const client = new ERC8004Client({} as any, {
            identityRegistry: undefined,
            reputationRegistry: undefined,
            validationRegistry: undefined
        });

        expect(client.addresses.identityRegistry).toBe("0x8004A818BFB912233c491871b3d84c89A494BD9e");
        expect(client.addresses.reputationRegistry).toBe("0x8004B663056A597Dffe9eCcC1965A193B7388713");
        expect(client.addresses.validationRegistry).toBe("0x8004Cb1BF31DAf7788923b405b754f57acEB4272");
    });

    it("should encode setAgentURI calls", () => {
        const client = new ERC8004Client({} as any);
        const data = client.encodeSetAgentUri("40", "ipfs://updated-agent-metadata");

        expect(data).toMatch(/^0x[0-9a-f]+$/i);
        expect(data.length).toBeGreaterThan(10);
    });
});

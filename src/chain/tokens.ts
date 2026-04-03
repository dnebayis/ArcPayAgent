import { ethers } from "ethers";

const STABLECOIN_DECIMALS = 6;

const ERC20_ABI = [
    "function balanceOf(address account) view returns (uint256)",
    "function allowance(address owner, address spender) view returns (uint256)",
    "function approve(address spender, uint256 amount) returns (bool)",
    "function transfer(address to, uint256 amount) returns (bool)",
];

export type TokenSymbol = "USDC" | "EURC";

export class TokenOps {
    private contracts: Record<TokenSymbol, ethers.Contract>;

    constructor(
        private provider: ethers.Provider,
        usdcAddress: string,
        eurcAddress: string
    ) {
        this.contracts = {
            USDC: new ethers.Contract(usdcAddress, ERC20_ABI, provider),
            EURC: new ethers.Contract(eurcAddress, ERC20_ABI, provider),
        };
    }

    getAddress(token: TokenSymbol): string {
        return this.contracts[token].target as string;
    }

    async balanceOf(token: TokenSymbol, address: string): Promise<bigint> {
        return this.contracts[token].balanceOf(address);
    }

    async allowance(token: TokenSymbol, owner: string, spender: string): Promise<bigint> {
        return this.contracts[token].allowance(owner, spender);
    }

    encodeApprove(token: TokenSymbol, spender: string, amount: bigint): string {
        return this.contracts[token].interface.encodeFunctionData("approve", [spender, amount]);
    }

    encodeTransfer(token: TokenSymbol, to: string, amount: bigint): string {
        return this.contracts[token].interface.encodeFunctionData("transfer", [to, amount]);
    }

    /**
     * Parse a human-readable amount string to bigint (6 decimals).
     */
    static parseAmount(amount: string): bigint {
        return ethers.parseUnits(amount, STABLECOIN_DECIMALS);
    }

    /**
     * Format a bigint to human-readable string.
     */
    static formatAmount(amount: bigint): string {
        return ethers.formatUnits(amount, STABLECOIN_DECIMALS);
    }
}

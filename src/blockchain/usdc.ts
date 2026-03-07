import { ethers } from "ethers";

const ERC20_ABI = [
    "function allowance(address owner, address spender) view returns (uint256)",
    "function approve(address spender, uint256 amount) returns (bool)",
    "function balanceOf(address account) view returns (uint256)"
];

export class USDC {
    private contract: ethers.Contract;

    constructor(private provider: ethers.Provider, private address: string) {
        this.contract = new ethers.Contract(address, ERC20_ABI, provider);
    }

    async allowance(walletAddress: string, spenderAddress: string): Promise<bigint> {
        return await this.contract.allowance(walletAddress, spenderAddress);
    }

    async approve(wallet: ethers.Wallet, spenderAddress: string, amount: bigint): Promise<ethers.TransactionResponse> {
        const connectedContract = this.contract.connect(wallet) as ethers.Contract;
        return await connectedContract.approve(spenderAddress, amount);
    }

    encodeApprove(spenderAddress: string, amount: bigint): string {
        return this.contract.interface.encodeFunctionData("approve", [spenderAddress, amount]);
    }

    async balanceOf(walletAddress: string): Promise<bigint> {
        return await this.contract.balanceOf(walletAddress);
    }

    getAddress(): string {
        return this.address;
    }
}

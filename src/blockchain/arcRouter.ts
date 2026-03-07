import { ethers } from "ethers";

const ROUTER_ABI = [
    "function pay(address to, uint256 amount, bytes32 proofHash, string memo) returns (bool)"
];

export class ArcRouter {
    private contract: ethers.Contract;

    constructor(private provider: ethers.Provider, private address: string) {
        this.contract = new ethers.Contract(address, ROUTER_ABI, provider);
    }

    async pay(wallet: ethers.Wallet, beneficiary: string, amount: bigint, memo: string): Promise<ethers.TransactionResponse> {
        const connectedContract = this.contract.connect(wallet) as ethers.Contract;
        // proofHash: keccak256 of the memo as a simple proof
        const proofHash = ethers.keccak256(ethers.toUtf8Bytes(memo || "ArcPay"));
        return await connectedContract.pay(beneficiary, amount, proofHash, memo);
    }

    encodePay(beneficiary: string, amount: bigint, memo: string): string {
        const proofHash = ethers.keccak256(ethers.toUtf8Bytes(memo || "ArcPay"));
        return this.contract.interface.encodeFunctionData("pay", [beneficiary, amount, proofHash, memo]);
    }
}

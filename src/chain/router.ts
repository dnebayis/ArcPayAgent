import { ethers } from "ethers";

const ROUTER_ABI = [
    "function pay(address to, uint256 amount, bytes32 proofHash, string memo) returns (bool)",
];

export class ArcRouter {
    private iface: ethers.Interface;

    constructor(private routerAddress: string) {
        this.iface = new ethers.Interface(ROUTER_ABI);
    }

    get address(): string {
        return this.routerAddress;
    }

    /**
     * Encode a pay() call for Circle contract execution.
     */
    encodePay(beneficiary: string, amount: bigint, memo: string = "ArcPay"): string {
        const proofHash = ethers.keccak256(ethers.solidityPacked(["string"], [memo]));
        return this.iface.encodeFunctionData("pay", [beneficiary, amount, proofHash, memo]);
    }
}

import { ethers } from "ethers";

export const ARC_TESTNET_CHAIN_ID = 5042002n;
export const ARC_TESTNET_RPC_URL = "https://rpc.testnet.arc.network";
export const DEFAULT_ARC_GAS_RESERVE_USDC = "0.10";

export function getExpectedArcChainId(): bigint {
    const raw = process.env.ARC_CHAIN_ID?.trim();
    if (!raw) {
        return ARC_TESTNET_CHAIN_ID;
    }

    try {
        return BigInt(raw);
    } catch {
        return ARC_TESTNET_CHAIN_ID;
    }
}

export function getArcGasReserveUsdc(): bigint {
    const raw = process.env.ARC_GAS_RESERVE_USDC?.trim() || DEFAULT_ARC_GAS_RESERVE_USDC;

    try {
        return ethers.parseUnits(raw, 6);
    } catch {
        return ethers.parseUnits(DEFAULT_ARC_GAS_RESERVE_USDC, 6);
    }
}

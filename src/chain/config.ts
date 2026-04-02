import { getConfig } from "../config";

export const ARC_TESTNET_CHAIN_ID = 5042002n;
export const STABLECOIN_DECIMALS = 6;
export const ARCSCAN_BASE = "https://testnet.arcscan.app";

export function getArcRpcUrl(): string {
    return getConfig().ARC_RPC_URL;
}

export function getGasReserve(): bigint {
    const cfg = getConfig();
    const parts = cfg.ARC_GAS_RESERVE_USDC.split(".");
    const int = parts[0] || "0";
    const dec = (parts[1] || "").padEnd(STABLECOIN_DECIMALS, "0").slice(0, STABLECOIN_DECIMALS);
    return BigInt(int + dec);
}

export function getContractAddresses() {
    const cfg = getConfig();
    return {
        usdc: cfg.USDC_ADDRESS,
        eurc: cfg.EURC_ADDRESS,
        router: cfg.PAYABLES_ROUTER_ADDRESS,
        identityRegistry: cfg.ERC8004_IDENTITY_REGISTRY,
        reputationRegistry: cfg.ERC8004_REPUTATION_REGISTRY,
        validationRegistry: cfg.ERC8004_VALIDATION_REGISTRY,
    };
}

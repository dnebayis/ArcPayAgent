/**
 * Shared constants used across the codebase.
 * Runtime config (env-driven) lives in src/config.ts — this file holds values
 * that are identity/branding/explorer URLs and are not user-configurable.
 */

export const BRAND_NAME = "ArcPay Agent";
export const DEFAULT_BOT_USERNAME = "ArcPayAgentBot";
export const TWITTER_HANDLE = "ArcPayAgent";
export const TWITTER_URL = `https://x.com/${TWITTER_HANDLE}`;

/** Memo written on-chain for router.pay() calls. */
export const DEFAULT_PAYMENT_MEMO = "ArcPay";

/** Arc Testnet block explorer base URL (no trailing slash). */
export const ARC_EXPLORER_URL = "https://testnet.arcscan.app";

export const arcExplorerAddress = (address: string): string =>
    `${ARC_EXPLORER_URL}/address/${address}`;

export const arcExplorerTx = (txHash: string): string =>
    `${ARC_EXPLORER_URL}/tx/${txHash}`;

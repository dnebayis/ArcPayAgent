import { ethers } from "ethers";
import { parseScheduleDate } from "../utils/dateParser";

export interface IntentToValidate {
    action: string;
    amount?: number;
    beneficiary?: string;
    schedule_time?: string;
    message?: string;
}

export interface ValidationResult {
    safeToExecute: boolean;
    needsClarification: boolean;
    message?: string;
}

function isStrictAddress(value: string): boolean {
    return ethers.isAddress(value);
}

export function validateIntent(intent: IntentToValidate): ValidationResult {
    if (intent.action === "create_payment") {
        if (!intent.beneficiary) {
            return {
                safeToExecute: false,
                needsClarification: true,
                message: intent.amount
                    ? `Who should I send ${intent.amount} USDC to?`
                    : "Who should I send the payment to?"
            };
        }

        if (intent.amount === undefined || intent.amount === null || Number.isNaN(intent.amount) || intent.amount <= 0) {
            return {
                safeToExecute: false,
                needsClarification: true,
                message: `How much USDC would you like me to send to ${intent.beneficiary}?`
            };
        }

        if (intent.beneficiary.startsWith("0x") && !isStrictAddress(intent.beneficiary)) {
            return {
                safeToExecute: false,
                needsClarification: true,
                message: "That wallet address looks invalid. Please send a full valid 0x address."
            };
        }
    }

    if (intent.action === "schedule_payment") {
        if (!intent.beneficiary) {
            return {
                safeToExecute: false,
                needsClarification: true,
                message: "Who should I schedule this payment for? Use a saved vendor or a full 0x address."
            };
        }

        if (intent.amount === undefined || intent.amount === null || Number.isNaN(intent.amount) || intent.amount <= 0) {
            return {
                safeToExecute: false,
                needsClarification: true,
                message: `How much USDC should I schedule for ${intent.beneficiary}?`
            };
        }

        if (!intent.schedule_time) {
            return {
                safeToExecute: false,
                needsClarification: true,
                message: intent.amount && intent.beneficiary
                    ? `When should I schedule ${intent.amount} USDC to ${intent.beneficiary}?`
                    : "When should I schedule this payment?"
            };
        }

        if (!parseScheduleDate(intent.schedule_time)) {
            return {
                safeToExecute: false,
                needsClarification: true,
                message: "I couldn't understand the schedule time. Try something like `in 10 minutes` or `tomorrow`."
            };
        }

        if (intent.beneficiary.startsWith("0x") && !isStrictAddress(intent.beneficiary)) {
            return {
                safeToExecute: false,
                needsClarification: true,
                message: "That wallet address looks invalid. Please send a full valid 0x address."
            };
        }
    }

    return {
        safeToExecute: true,
        needsClarification: false
    };
}

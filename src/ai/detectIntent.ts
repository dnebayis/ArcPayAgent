export interface DetectedIntent {
    action: string;
    amount?: number;
    beneficiary?: string;
    name?: string;
    address?: string;
    schedule_time?: string;
    frequency?: string;
    message?: string;
}

const TIME_EXPRESSION = "((?:(?:after|in)\\s+)?\\d+\\s*(?:second|seconds|minute|minutes|hour|hours|day|days|week|weeks)|tomorrow|today|next\\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday))";

export function detectIntent(text: string): DetectedIntent | null {
    const arcScanLinkPattern = /^(?=.*(?:arc\s*scan|arcscan|block\s+explorer|explorer))(?=.*(?:link|url|site|website|open|send|give)).*$/i;
    if (arcScanLinkPattern.test(text)) {
        return {
            action: "chat",
            message: "ArcScan testnet explorer: https://testnet.arcscan.app/"
        };
    }

    const walletBalancePattern = /^wallet\s+balance$/i;
    if (walletBalancePattern.test(text)) {
        return { action: "wallet_intelligence" };
    }

    const explicitSchedulePattern = new RegExp(
        `^schedule\\s+payment\\s+(\\d+(?:\\.\\d+)?)\\s+usdc\\s+(?:to\\s+)?(0[xX][a-fA-F0-9]{40}|[a-zA-Z0-9_]+)\\s+${TIME_EXPRESSION}$`,
        "i"
    );
    const explicitScheduleMatch = text.match(explicitSchedulePattern);
    if (explicitScheduleMatch) {
        return {
            action: "schedule_payment",
            amount: parseFloat(explicitScheduleMatch[1]),
            beneficiary: explicitScheduleMatch[2],
            schedule_time: explicitScheduleMatch[3]
        };
    }

    const explicitScheduleCandidatePattern = /^schedule\s+payment\s+(\d+(?:\.\d+)?)\s+usdc\s+(?:to\s+)?(0[xX][a-fA-F0-9]{40}|[a-zA-Z0-9_]+)\s+(.+)$/i;
    const explicitScheduleCandidateMatch = text.match(explicitScheduleCandidatePattern);
    if (explicitScheduleCandidateMatch) {
        return {
            action: "schedule_payment",
            amount: parseFloat(explicitScheduleCandidateMatch[1]),
            beneficiary: explicitScheduleCandidateMatch[2],
            schedule_time: explicitScheduleCandidateMatch[3]
        };
    }

    const scheduledPaymentPattern = new RegExp(
        `^(?:send|pay|transfer)\\s+(\\d+(?:\\.\\d+)?)\\s+usdc\\s+(?:to\\s+)?(0[xX][a-fA-F0-9]{40}|[a-zA-Z0-9_]+)\\s+${TIME_EXPRESSION}$`,
        "i"
    );
    const scheduledMatch = text.match(scheduledPaymentPattern);
    if (scheduledMatch) {
        return {
            action: "schedule_payment",
            amount: parseFloat(scheduledMatch[1]),
            beneficiary: scheduledMatch[2],
            schedule_time: scheduledMatch[3]
        };
    }

    const scheduledPaymentCandidatePattern = /^(?:send|pay|transfer)\s+(\d+(?:\.\d+)?)\s+usdc\s+(?:to\s+)?(0[xX][a-fA-F0-9]{40}|[a-zA-Z0-9_]+)\s+((?:after|in)\s+.+)$/i;
    const scheduledPaymentCandidateMatch = text.match(scheduledPaymentCandidatePattern);
    if (scheduledPaymentCandidateMatch) {
        return {
            action: "schedule_payment",
            amount: parseFloat(scheduledPaymentCandidateMatch[1]),
            beneficiary: scheduledPaymentCandidateMatch[2],
            schedule_time: scheduledPaymentCandidateMatch[3]
        };
    }

    const sendPattern1 = /^send\s+(\d+(?:\.\d+)?)\s+usdc\s+(?:to\s+)?([a-zA-Z0-9_x]+)$/i;
    const send1Match = text.match(sendPattern1);
    if (send1Match) {
        return { action: "create_payment", amount: parseFloat(send1Match[1]), beneficiary: send1Match[2] };
    }

    const sendPattern2 = /^(0[xX][a-fA-F0-9]{40})\s+send\s+(\d+(?:\.\d+)?)\s+usdc$/i;
    const send2Match = text.match(sendPattern2);
    if (send2Match) {
        return { action: "create_payment", amount: parseFloat(send2Match[2]), beneficiary: send2Match[1] };
    }

    const payPattern = /^pay\s+(\d+(?:\.\d+)?)\s+usdc\s+(?:to\s+)?([a-zA-Z0-9_x]+)$/i;
    const payMatch = text.match(payPattern);
    if (payMatch) {
        return { action: "create_payment", amount: parseFloat(payMatch[1]), beneficiary: payMatch[2] };
    }

    const transferPattern = /^transfer\s+(\d+(?:\.\d+)?)\s+usdc\s+(?:to\s+)?([a-zA-Z0-9_x]+)$/i;
    const transferMatch = text.match(transferPattern);
    if (transferMatch) {
        return { action: "create_payment", amount: parseFloat(transferMatch[1]), beneficiary: transferMatch[2] };
    }

    const sendNoAmountPattern = /^(?:send|pay)\s+([a-zA-Z0-9_x]+)$/i;
    const sendNoAmountMatch = text.match(sendNoAmountPattern);
    if (sendNoAmountMatch) {
        return { action: "create_payment", beneficiary: sendNoAmountMatch[1] };
    }

    return null;
}

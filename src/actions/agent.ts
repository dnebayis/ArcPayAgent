import { registerAction } from "./registry";
import type { IdentityEngine } from "../engines/identity";
import type { RequestEngine } from "../engines/requests";
import type { InvoiceEngine } from "../engines/invoice";

export interface AgentActionDeps {
    identityEngine: IdentityEngine;
    requestEngine: RequestEngine;
    invoiceEngine: InvoiceEngine;
    send: (chatId: number, text: string) => Promise<void>;
}

export function registerAgentActions(deps: AgentActionDeps): void {
    registerAction("agent_status", async (chatId) => {
        await deps.identityEngine.getStatus(chatId);
    });

    registerAction("agent_identity", async (chatId) => {
        await deps.identityEngine.getIdentity(chatId);
    });

    registerAction("agent_validation_status", async (chatId) => {
        await deps.identityEngine.getValidationStatus(chatId);
    });

    registerAction("create_payment_request", async (chatId, params) => {
        const { amount, token } = params;
        if (!amount) {
            await deps.send(chatId, "Please specify an amount for the payment request.");
            return;
        }
        await deps.requestEngine.createRequest(chatId, Number(amount), token || "USDC");
    });

    registerAction("analyze_invoice", async (chatId) => {
        await deps.send(chatId, "Please upload an invoice image or PDF to analyze.");
    });
}

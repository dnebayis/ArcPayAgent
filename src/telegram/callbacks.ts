import TelegramBot from "node-telegram-bot-api";
import type { BotDeps } from "./bot";

export function attachCallbackHandlers(bot: TelegramBot, deps: BotDeps): void {
    bot.on("callback_query", async (query) => {
        const chatId = query.message?.chat.id;
        if (!chatId) return;

        const data = query.data || "";

        try { await bot.answerCallbackQuery(query.id); } catch { /* */ }

        // Remove inline keyboard after click
        if (query.message?.message_id) {
            try {
                await bot.editMessageReplyMarkup(
                    { inline_keyboard: [] },
                    { chat_id: chatId, message_id: query.message.message_id }
                );
            } catch { /* message may be too old */ }
        }

        // Payment confirm/cancel
        if (data === "payment_confirm") {
            await deps.paymentEngine.processCallback(chatId, "confirm");
            return;
        }
        if (data === "payment_cancel") {
            await deps.paymentEngine.processCallback(chatId, "cancel");
            return;
        }

        // Invoice callbacks
        if (data.startsWith("invoice_")) {
            const result = await deps.invoiceEngine.processCallback(chatId, data);
            if (result?.preparePayment) {
                const { vendor, amount, token } = result.preparePayment;
                await deps.paymentEngine.prepare(chatId, vendor, amount, token as any);
            }
            return;
        }

        // Payment request callbacks
        if (data.startsWith("request_pay_")) {
            const requestId = data.replace("request_pay_", "");
            const req = await deps.requests.get(requestId);
            if (req && !req.paid) {
                await deps.paymentEngine.prepare(chatId, req.recipientAddress, req.amount, req.token, null, {
                    type: "request",
                    requestId: req.id,
                    originChatId: req.chatId,
                });
            }
            return;
        }
        if (data.startsWith("request_decline_")) {
            await deps.sender.send(chatId, "Payment request declined.");
            return;
        }
    });
}

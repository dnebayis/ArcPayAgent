import { z } from "zod";

export const PaymentIntentSchema = z.object({
    amount: z.number(),
    recipient: z.string(),
});

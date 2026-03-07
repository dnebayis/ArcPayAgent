import { detectIntent, type DetectedIntent } from "./detectIntent";
import { normalizeInput } from "./normalizeInput";

export interface DecisionResult {
    normalizedText: string;
    detectedIntent: DetectedIntent | null;
    source: "detector" | "fallback";
}

export function buildDecision(rawText: string): DecisionResult {
    const normalizedText = normalizeInput(rawText);
    const detectedIntent = detectIntent(normalizedText);

    return {
        normalizedText,
        detectedIntent,
        source: detectedIntent ? "detector" : "fallback"
    };
}

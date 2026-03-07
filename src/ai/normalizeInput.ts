const LEADING_FILLERS = /^(?:okay|ok|please|pls|hey|hi|hello|can you|could you|would you)\b[\s,]*/i;

export function normalizeInput(input: string): string {
    let normalized = input.trim();
    const original = normalized;

    while (LEADING_FILLERS.test(normalized)) {
        normalized = normalized.replace(LEADING_FILLERS, "").trim();
    }

    normalized = normalized.replace(/\s+/g, " ").trim();
    return normalized || original;
}

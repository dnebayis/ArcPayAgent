const LEADING_FILLERS = /^(?:okay|ok|please|pls|hey|hi|hello|can you|could you|would you)\b[\s,]*/i;

export function normalizeInput(input: string): string {
    let normalized = input.trim();

    while (LEADING_FILLERS.test(normalized)) {
        normalized = normalized.replace(LEADING_FILLERS, "").trim();
    }

    return normalized.replace(/\s+/g, " ").trim();
}

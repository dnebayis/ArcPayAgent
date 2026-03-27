export function escapeTelegramMarkdown(value: string): string {
    return value.replace(/([_*`\[])/g, "\\$1");
}

/**
 * Converts LLM-generated markdown to Telegram Markdown v1 compatible format.
 * Telegram v1 only supports: *bold*, _italic_, `code`, [link](url)
 * LLMs often produce **bold**, ### headers, etc. which break entity parsing.
 */
export function sanitizeForTelegram(text: string): string {
    return text
        // **bold** → *bold*  (double → single asterisk)
        .replace(/\*\*(.+?)\*\*/gs, "*$1*")
        // ### headers → plain text (strip #)
        .replace(/^#{1,6}\s+/gm, "")
        // ~~strikethrough~~ → plain text
        .replace(/~~(.+?)~~/gs, "$1")
        // Remove HTML tags if any
        .replace(/<[^>]+>/g, "")
        // Escape lone underscores that aren't part of _italic_ pairs
        // (hex addresses, variable names like foo_bar, etc.)
        .replace(/(?<![_\w])_(?![_\w])/g, "\\_");
}

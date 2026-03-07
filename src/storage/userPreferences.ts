import { loadStore, saveStore } from "./persistence";

const PREFERENCES_FILE = "user_preferences.json";

export interface UserPreferences {
    locale?: string;
    timeZone?: string;
    updatedAt: number;
}

export class UserPreferencesStore {
    private store: Record<string, UserPreferences>;

    constructor() {
        this.store = loadStore<Record<string, UserPreferences>>(PREFERENCES_FILE);
    }

    private persist(): void {
        saveStore(PREFERENCES_FILE, this.store);
    }

    getPreferences(chatId: number | string): Required<Pick<UserPreferences, "locale" | "timeZone">> {
        const prefs = this.store[chatId.toString()];
        return {
            locale: prefs?.locale || process.env.DEFAULT_LOCALE || "en-US",
            timeZone: prefs?.timeZone || process.env.TZ || "UTC"
        };
    }

    setLocaleIfMissing(chatId: number | string, locale: string): void {
        const id = chatId.toString();
        if (!locale) return;
        if (this.store[id]?.locale) return;

        this.store[id] = {
            ...this.store[id],
            locale: locale.includes("-") ? locale : `${locale}-${locale.toUpperCase()}`,
            updatedAt: Date.now()
        };
        this.persist();
    }
}

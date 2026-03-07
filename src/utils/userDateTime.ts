export interface UserDateTimePreferences {
    locale: string;
    timeZone: string;
}

export function formatUserDateTime(timestamp: number, preferences: UserDateTimePreferences): string {
    return new Intl.DateTimeFormat(preferences.locale, {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: preferences.timeZone
    }).format(new Date(timestamp));
}

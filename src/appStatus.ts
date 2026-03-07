export interface ReadinessState {
    persistenceReady: boolean;
    botReady: boolean;
    schedulerReady: boolean;
}

const readinessState: ReadinessState = {
    persistenceReady: false,
    botReady: false,
    schedulerReady: false
};

export function markPersistenceReady(): void {
    readinessState.persistenceReady = true;
}

export function markBotReady(): void {
    readinessState.botReady = true;
}

export function markSchedulerReady(): void {
    readinessState.schedulerReady = true;
}

export function getReadinessState(): ReadinessState {
    return { ...readinessState };
}

export function isAppReady(): boolean {
    return readinessState.persistenceReady && readinessState.botReady;
}

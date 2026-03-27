import { buildAgentIdentityRuntime } from "./agent-identity-runtime";

async function main(): Promise<void> {
    const { engine } = await buildAgentIdentityRuntime();
    const before = engine.getStatus();
    if (before.registered) {
        const synced = await engine.syncRegistration();
        console.log("Arc Pay Agent is already registered.");
        console.log(JSON.stringify(synced, null, 2));
        return;
    }

    const status = await engine.registerAgent();
    console.log("Arc Pay Agent registration completed.");
    console.log(JSON.stringify(status, null, 2));
}

main().catch((error) => {
    console.error(error.message || error);
    process.exit(1);
});

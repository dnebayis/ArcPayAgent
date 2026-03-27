import { buildAgentIdentityRuntime } from "./agent-identity-runtime";

async function main(): Promise<void> {
    const { engine } = await buildAgentIdentityRuntime();
    const status = await engine.syncRegistration();
    console.log(JSON.stringify(status, null, 2));
}

main().catch((error) => {
    console.error(error.message || error);
    process.exit(1);
});

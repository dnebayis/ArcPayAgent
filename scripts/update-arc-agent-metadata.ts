import { buildAgentIdentityRuntime } from "./agent-identity-runtime";

async function main(): Promise<void> {
    const { engine, config } = await buildAgentIdentityRuntime();
    const metadataUri = config.ARC_AGENT_METADATA_URI;

    if (!metadataUri) {
        throw new Error("ARC_AGENT_METADATA_URI is required to update Arc Pay Agent metadata.");
    }

    const status = await engine.updateMetadata(metadataUri);
    console.log("Arc Pay Agent metadata updated.");
    console.log(JSON.stringify(status, null, 2));
}

main().catch((error) => {
    console.error(error.message || error);
    process.exit(1);
});

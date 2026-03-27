import { buildAgentIdentityRuntime } from "./agent-identity-runtime";

async function main(): Promise<void> {
    const [, , scoreArg, tagArg] = process.argv;
    const score = scoreArg || "95";
    const tag = tagArg || "trusted_payment_agent";
    const { engine } = await buildAgentIdentityRuntime();
    const txId = await engine.recordReputation(score, tag);
    console.log(JSON.stringify({ txId, score, tag }, null, 2));
}

main().catch((error) => {
    console.error(error.message || error);
    process.exit(1);
});

import { buildAgentIdentityRuntime } from "./agent-identity-runtime";
import { buildKycValidationRequestHash } from "../src/engines/validationRequest";

async function main(): Promise<void> {
    const [, , requestHashArg] = process.argv;
    const { engine, erc8004Client } = await buildAgentIdentityRuntime();
    const status = engine.getStatus();

    const requestHash = requestHashArg || (status.agentId ? buildKycValidationRequestHash(status.agentId) : null);
    if (!requestHash) {
        throw new Error("A request hash is required, or Arc Pay Agent must already have an agentId so the KYC request hash can be derived.");
    }

    const validation = await erc8004Client.getValidationStatus(requestHash);
    console.log(JSON.stringify({
        requestHash,
        ...validation
    }, null, 2));
}

main().catch((error) => {
    console.error(error.message || error);
    process.exit(1);
});

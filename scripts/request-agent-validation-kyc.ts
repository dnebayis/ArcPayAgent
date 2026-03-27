import { buildAgentIdentityRuntime } from "./agent-identity-runtime";
import {
    buildKycValidationRequestHash,
    buildKycValidationRequestUri
} from "../src/engines/validationRequest";

async function main(): Promise<void> {
    const [, , requestUriArg] = process.argv;
    const { engine, circleAgentClient } = await buildAgentIdentityRuntime();
    const status = engine.getStatus();

    if (!status.registered || !status.agentId) {
        throw new Error("Arc Pay Agent must be registered before creating a KYC validation request.");
    }

    const requestHash = buildKycValidationRequestHash(status.agentId);
    const requestUri = requestUriArg || buildKycValidationRequestUri(status.agentId, status.metadataUri);
    const txId = await engine.requestValidation(requestUri, requestHash);
    const finalTx = await circleAgentClient.waitForTerminalTransaction(txId, {
        attempts: 30,
        intervalMs: 2000
    });

    if (!finalTx) {
        throw new Error(`KYC validation request ${txId} did not reach a terminal Circle state in time.`);
    }

    console.log(JSON.stringify({
        txId,
        requestUri,
        requestHash,
        finalState: finalTx.state,
        txHash: finalTx.txHash,
        errorReason: finalTx.errorReason,
        errorDetails: finalTx.errorDetails
    }, null, 2));

    if (!circleAgentClient.isSuccessfulTerminalState(finalTx.state)) {
        process.exit(1);
    }
}

main().catch((error) => {
    console.error(error.message || error);
    process.exit(1);
});

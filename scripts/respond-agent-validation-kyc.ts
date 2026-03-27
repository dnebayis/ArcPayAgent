import { buildAgentIdentityRuntime } from "./agent-identity-runtime";
import {
    buildKycValidationRequestHash,
    DEFAULT_KYC_VALIDATION_TAG
} from "../src/engines/validationRequest";
import {
    buildValidationResponsePayload,
    DEFAULT_VALIDATION_RESPONSE
} from "../src/engines/validationResponse";

async function main(): Promise<void> {
    const [, , responseArg, tagArg] = process.argv;
    const { engine, circleAgentClient } = await buildAgentIdentityRuntime();
    const status = engine.getStatus();

    if (!status.registered || !status.agentId) {
        throw new Error("Arc Pay Agent must be registered before responding to a KYC validation request.");
    }

    const requestHash = buildKycValidationRequestHash(status.agentId);
    const { response, tag, responseHash } = buildValidationResponsePayload(
        requestHash,
        responseArg || DEFAULT_VALIDATION_RESPONSE,
        tagArg || DEFAULT_KYC_VALIDATION_TAG
    );

    const txId = await engine.respondValidation(requestHash, response, tag, responseHash);
    const finalTx = await circleAgentClient.waitForTerminalTransaction(txId, {
        attempts: 30,
        intervalMs: 2000
    });

    if (!finalTx) {
        throw new Error(`KYC validation response ${txId} did not reach a terminal Circle state in time.`);
    }

    console.log(JSON.stringify({
        txId,
        requestHash,
        response,
        tag,
        responseHash,
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

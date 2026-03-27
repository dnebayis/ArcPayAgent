import { buildAgentIdentityRuntime } from "./agent-identity-runtime";
import {
    buildValidationResponsePayload,
    DEFAULT_VALIDATION_RESPONSE,
    DEFAULT_VALIDATION_TAG
} from "../src/engines/validationResponse";

async function main(): Promise<void> {
    const [, , requestHash, responseArg, tagArg] = process.argv;
    if (!requestHash) {
        throw new Error(`Usage: npm run agent:validation:respond -- <requestHash> [response=${DEFAULT_VALIDATION_RESPONSE}] [tag=${DEFAULT_VALIDATION_TAG}]`);
    }
    const { response, tag, responseHash } = buildValidationResponsePayload(requestHash, responseArg, tagArg);
    const { engine } = await buildAgentIdentityRuntime();
    const txId = await engine.respondValidation(requestHash, response, tag, responseHash);
    console.log(JSON.stringify({ txId, requestHash, response, tag, responseHash }, null, 2));
}

main().catch((error) => {
    console.error(error.message || error);
    process.exit(1);
});

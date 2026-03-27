import { ethers } from "ethers";
import { buildAgentIdentityRuntime } from "./agent-identity-runtime";

async function main(): Promise<void> {
    const [, , requestUriArg, requestHashArg] = process.argv;
    const requestUri = requestUriArg || "ipfs://replace-with-validation-request";
    const requestHash = requestHashArg || ethers.keccak256(ethers.toUtf8Bytes(`arc-pay-agent-validation-${Date.now()}`));
    const { engine } = await buildAgentIdentityRuntime();
    const txId = await engine.requestValidation(requestUri, requestHash);
    console.log(JSON.stringify({ txId, requestUri, requestHash }, null, 2));
}

main().catch((error) => {
    console.error(error.message || error);
    process.exit(1);
});

import { ethers } from "ethers";

export const DEFAULT_VALIDATION_RESPONSE = "100";
export const DEFAULT_VALIDATION_TAG = "service_verified";

export interface ValidationResponsePayload {
    requestHash: string;
    response: string;
    tag: string;
    responseHash: string;
}

export function buildValidationResponsePayload(
    requestHash: string,
    response = DEFAULT_VALIDATION_RESPONSE,
    tag = DEFAULT_VALIDATION_TAG
): ValidationResponsePayload {
    return {
        requestHash,
        response,
        tag,
        responseHash: ethers.keccak256(ethers.toUtf8Bytes(`${requestHash}:${response}:${tag}`))
    };
}

import { ethers } from "ethers";

export const DEFAULT_KYC_VALIDATION_TAG = "kyc_verified";

export function buildKycValidationRequestHash(agentId: string): string {
    return ethers.keccak256(ethers.toUtf8Bytes(`kyc_verification_request_agent_${agentId}`));
}

export function buildKycValidationRequestUri(agentId: string, metadataUri?: string | null): string {
    if (metadataUri) {
        return `${metadataUri}#kyc_verification_request_agent_${agentId}`;
    }

    return `urn:arc:kyc-validation-request:agent:${agentId}`;
}

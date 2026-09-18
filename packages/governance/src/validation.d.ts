import { type ArtifactManifest, type EvidenceRecord, type JsonValue, type Principal, type ResourceReference, type ToolExecutionRequest, type ToolExecutionScope, type VerificationObjective } from './types.js';
export declare class ValidationError extends Error {
    readonly code: "VALIDATION_ERROR";
    constructor(message: string);
}
export declare function parsePrincipal(input: unknown): Principal;
export declare function parseResourceReference(input: unknown): ResourceReference;
export declare function parseToolExecutionRequest(input: unknown): ToolExecutionRequest;
export declare function parseToolExecutionScope(input: unknown): ToolExecutionScope;
export declare function parseEvidenceRecord(input: unknown): EvidenceRecord;
export declare function parseVerificationObjective(input: unknown): VerificationObjective;
export declare function parseArtifactManifest(input: unknown): ArtifactManifest;
export declare function isJsonValue(value: unknown): value is JsonValue;
//# sourceMappingURL=validation.d.ts.map
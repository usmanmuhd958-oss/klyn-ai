import { EVIDENCE_KINDS, RESOURCE_KINDS, RISK_LEVELS, VERIFICATION_STATUSES, } from './types.js';
export class ValidationError extends Error {
    code = 'VALIDATION_ERROR';
    constructor(message) {
        super(message);
        this.name = 'ValidationError';
    }
}
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function readString(record, key) {
    const value = record[key];
    if (typeof value !== 'string' || value.length === 0) {
        throw new ValidationError(`${key} must be a non-empty string`);
    }
    return value;
}
function readFiniteNumber(record, key) {
    const value = record[key];
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new ValidationError(`${key} must be a finite number`);
    }
    return value;
}
function readStringArray(record, key) {
    const value = record[key];
    if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string' || entry.length === 0)) {
        throw new ValidationError(`${key} must be an array of non-empty strings`);
    }
    return Object.freeze([...value]);
}
function readEnum(record, key, allowed) {
    const value = record[key];
    if (typeof value !== 'string' || !allowed.includes(value)) {
        throw new ValidationError(`${key} is invalid`);
    }
    return value;
}
function rejectWildcard(value, field) {
    if (value.includes('*'))
        throw new ValidationError(`${field} must not contain wildcard selectors`);
    return value;
}
function validateDigest(value, field) {
    if (!/^[a-f0-9]{64}$/i.test(value)) {
        throw new ValidationError(`${field} must be a SHA-256 hex digest`);
    }
    return value.toLowerCase();
}
export function parsePrincipal(input) {
    if (!isRecord(input))
        throw new ValidationError('principal must be an object');
    return Object.freeze({ principalId: readString(input, 'principalId'), sessionId: readString(input, 'sessionId') });
}
export function parseResourceReference(input) {
    if (!isRecord(input))
        throw new ValidationError('resource must be an object');
    const kind = readEnum(input, 'kind', RESOURCE_KINDS);
    const locator = readString(input, 'locator');
    return Object.freeze({ kind, locator });
}
export function parseToolExecutionRequest(input) {
    if (!isRecord(input))
        throw new ValidationError('tool execution request must be an object');
    const principal = parsePrincipal(input.principal);
    const resource = input.resource === undefined ? undefined : parseResourceReference(input.resource);
    const networkOrigin = input.networkOrigin === undefined ? undefined : readString(input, 'networkOrigin');
    return Object.freeze({
        requestId: readString(input, 'requestId'),
        objectiveId: readString(input, 'objectiveId'),
        principal,
        toolName: readString(input, 'toolName'),
        operation: readString(input, 'operation'),
        risk: readEnum(input, 'risk', RISK_LEVELS),
        ...(resource === undefined ? {} : { resource }),
        ...(networkOrigin === undefined ? {} : { networkOrigin }),
        declaredPurpose: readString(input, 'declaredPurpose'),
        requestedAtEpochMs: readFiniteNumber(input, 'requestedAtEpochMs'),
    });
}
function parseScopeResourceSelector(input) {
    if (!isRecord(input))
        throw new ValidationError('scope resource selector must be an object');
    const matchValue = input.match;
    if (matchValue !== 'exact' && matchValue !== 'prefix')
        throw new ValidationError('scope resource selector match is invalid');
    return Object.freeze({
        kind: readEnum(input, 'kind', RESOURCE_KINDS),
        match: matchValue,
        value: rejectWildcard(readString(input, 'value'), 'selector.value'),
    });
}
export function parseToolExecutionScope(input) {
    if (!isRecord(input))
        throw new ValidationError('tool execution scope must be an object');
    const resourcesInput = input.resources;
    if (!Array.isArray(resourcesInput))
        throw new ValidationError('resources must be an array');
    const resources = Object.freeze(resourcesInput.map(parseScopeResourceSelector));
    const networkOrigins = Object.freeze(readStringArray(input, 'networkOrigins').map((origin) => rejectWildcard(origin, 'networkOrigin')));
    return Object.freeze({
        scopeId: readString(input, 'scopeId'),
        principalId: readString(input, 'principalId'),
        toolName: rejectWildcard(readString(input, 'toolName'), 'toolName'),
        operation: rejectWildcard(readString(input, 'operation'), 'operation'),
        maxRisk: readEnum(input, 'maxRisk', RISK_LEVELS),
        resources,
        networkOrigins,
        expiresAtEpochMs: readFiniteNumber(input, 'expiresAtEpochMs'),
        policyVersion: readString(input, 'policyVersion'),
    });
}
export function parseEvidenceRecord(input) {
    if (!isRecord(input))
        throw new ValidationError('evidence record must be an object');
    return Object.freeze({
        evidenceId: readString(input, 'evidenceId'),
        objectiveId: readString(input, 'objectiveId'),
        kind: readEnum(input, 'kind', EVIDENCE_KINDS),
        statement: readString(input, 'statement'),
        source: readString(input, 'source'),
        payloadDigest: validateDigest(readString(input, 'payloadDigest'), 'payloadDigest'),
        invariantIds: readStringArray(input, 'invariantIds'),
        verificationStatus: readEnum(input, 'verificationStatus', VERIFICATION_STATUSES),
        verifierId: readString(input, 'verifierId'),
        collectedAtEpochMs: readFiniteNumber(input, 'collectedAtEpochMs'),
    });
}
export function parseVerificationObjective(input) {
    if (!isRecord(input))
        throw new ValidationError('verification objective must be an object');
    const raw = input.requiredInvariants;
    if (!Array.isArray(raw) || raw.length === 0)
        throw new ValidationError('requiredInvariants must be a non-empty array');
    const requiredInvariants = Object.freeze(raw.map((value) => {
        if (!isRecord(value))
            throw new ValidationError('verification invariant must be an object');
        return Object.freeze({ invariantId: readString(value, 'invariantId'), statement: readString(value, 'statement') });
    }));
    const ids = new Set();
    for (const invariant of requiredInvariants) {
        if (ids.has(invariant.invariantId))
            throw new ValidationError(`duplicate invariant: ${invariant.invariantId}`);
        ids.add(invariant.invariantId);
    }
    return Object.freeze({ objectiveId: readString(input, 'objectiveId'), requiredInvariants, policyVersion: readString(input, 'policyVersion') });
}
export function parseArtifactManifest(input) {
    if (!isRecord(input))
        throw new ValidationError('artifact manifest must be an object');
    return Object.freeze({
        artifactId: readString(input, 'artifactId'),
        artifactKind: readString(input, 'artifactKind'),
        contentDigest: validateDigest(readString(input, 'contentDigest'), 'contentDigest'),
        producerPrincipalId: readString(input, 'producerPrincipalId'),
        objectiveId: readString(input, 'objectiveId'),
        sourceCommitDigest: validateDigest(readString(input, 'sourceCommitDigest'), 'sourceCommitDigest'),
        createdAtEpochMs: readFiniteNumber(input, 'createdAtEpochMs'),
    });
}
export function isJsonValue(value) {
    if (value === null || typeof value === 'string' || typeof value === 'boolean')
        return true;
    if (typeof value === 'number')
        return Number.isFinite(value);
    if (Array.isArray(value))
        return value.every(isJsonValue);
    if (isRecord(value))
        return Object.values(value).every(isJsonValue);
    return false;
}
//# sourceMappingURL=validation.js.map
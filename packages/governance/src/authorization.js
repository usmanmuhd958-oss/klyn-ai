import { parseToolExecutionRequest, parseToolExecutionScope, ValidationError } from './validation.js';
const RISK_RANK = Object.freeze({ low: 0, medium: 1, high: 2, critical: 3 });
function matchesSelector(requestKind, requestLocator, selector) {
    if (selector.kind !== requestKind)
        return false;
    if (selector.match === 'exact')
        return requestLocator === selector.value;
    if (!requestLocator.startsWith(selector.value))
        return false;
    const boundary = selector.value.endsWith('/') || selector.value.endsWith(':') || selector.value.endsWith('#') || selector.value.endsWith('?');
    if (boundary)
        return true;
    return requestLocator.length === selector.value.length || requestLocator.charAt(selector.value.length) === '/';
}
function resourceAllowed(request, scope) {
    const resource = request.resource;
    if (resource === undefined)
        return scope.resources.length === 0;
    return scope.resources.some((selector) => matchesSelector(resource.kind, resource.locator, selector));
}
function networkAllowed(request, scope) {
    if (request.networkOrigin === undefined)
        return scope.networkOrigins.length === 0;
    return scope.networkOrigins.includes(request.networkOrigin);
}
export class ZeroTrustAuthorizer {
    authorize(requestInput, scopes, nowEpochMs = Date.now()) {
        let request;
        try {
            request = parseToolExecutionRequest(requestInput);
        }
        catch (error) {
            const requestId = typeof requestInput === 'object' && requestInput !== null && 'requestId' in requestInput && typeof requestInput.requestId === 'string'
                ? String(requestInput.requestId)
                : 'unknown';
            return Object.freeze({ allowed: false, reason: 'malformed-request', requestId, evaluatedAtEpochMs: nowEpochMs });
        }
        let sawExpired = false;
        let sawRiskMismatch = false;
        let sawResourceMismatch = false;
        let sawNetworkMismatch = false;
        for (const scopeInput of scopes) {
            let scope;
            try {
                scope = parseToolExecutionScope(scopeInput);
            }
            catch (error) {
                if (error instanceof ValidationError)
                    continue;
                continue;
            }
            if (scope.principalId !== request.principal.principalId || scope.toolName !== request.toolName || scope.operation !== request.operation)
                continue;
            if (nowEpochMs >= scope.expiresAtEpochMs) {
                sawExpired = true;
                continue;
            }
            if (RISK_RANK[request.risk] > RISK_RANK[scope.maxRisk]) {
                sawRiskMismatch = true;
                continue;
            }
            if (!resourceAllowed(request, scope)) {
                sawResourceMismatch = true;
                continue;
            }
            if (!networkAllowed(request, scope)) {
                sawNetworkMismatch = true;
                continue;
            }
            return Object.freeze({ allowed: true, reason: 'granted', requestId: request.requestId, scopeId: scope.scopeId, evaluatedAtEpochMs: nowEpochMs });
        }
        let reason = 'no-matching-scope';
        if (sawExpired)
            reason = 'scope-expired';
        else if (sawRiskMismatch)
            reason = 'risk-exceeds-scope';
        else if (sawResourceMismatch)
            reason = 'resource-not-allowed';
        else if (sawNetworkMismatch)
            reason = 'network-origin-not-allowed';
        return Object.freeze({ allowed: false, reason, requestId: request.requestId, evaluatedAtEpochMs: nowEpochMs });
    }
}
//# sourceMappingURL=authorization.js.map
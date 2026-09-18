const DEFAULT_PATTERNS = [
    /\b(?:sk|pk)-[A-Za-z0-9_-]{16,}\b/g,
    /\b(?:ghp|gho|github_pat)_[A-Za-z0-9_]{20,}\b/g,
    /\b(?:xox[baprs]-)[A-Za-z0-9-]{10,}\b/g,
    /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g,
    /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}\b/gi,
    /\b(?:token|secret|password|passwd|api[_-]?key)\s*[:=]\s*[^\s,;]+/gi,
];
/** Zero-trust environment filtering and output redaction for child processes. */
export class SecretMasker {
    patterns;
    replacement;
    constructor(options = {}) {
        this.patterns = [...DEFAULT_PATTERNS, ...(options.additionalPatterns ?? [])];
        this.replacement = options.replacement ?? "[REDACTED]";
    }
    maskEnvironment(environment, allowedKeys = []) {
        const allowed = new Set(allowedKeys);
        const masked = {};
        for (const [key, value] of Object.entries(environment)) {
            if (value === undefined || this.isSecretKey(key))
                continue;
            if (allowed.size > 0 && !allowed.has(key))
                continue;
            masked[key] = value;
        }
        return masked;
    }
    redact(text) {
        return this.patterns.reduce((result, pattern) => {
            pattern.lastIndex = 0;
            return result.replace(pattern, this.replacement);
        }, text);
    }
    isSecretKey(key) {
        return /(?:secret|token|password|passwd|api[_-]?key|credential|private[_-]?key|auth)/i.test(key);
    }
}
//# sourceMappingURL=secret-masker.js.map
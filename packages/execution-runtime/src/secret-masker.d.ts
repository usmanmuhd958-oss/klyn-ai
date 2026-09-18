export interface SecretMaskerOptions {
    additionalPatterns?: readonly RegExp[];
    replacement?: string;
}
/** Zero-trust environment filtering and output redaction for child processes. */
export declare class SecretMasker {
    private readonly patterns;
    private readonly replacement;
    constructor(options?: SecretMaskerOptions);
    maskEnvironment(environment: NodeJS.ProcessEnv, allowedKeys?: readonly string[]): NodeJS.ProcessEnv;
    redact(text: string): string;
    isSecretKey(key: string): boolean;
}
//# sourceMappingURL=secret-masker.d.ts.map
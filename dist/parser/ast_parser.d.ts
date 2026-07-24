import type { ASTNode } from '../types/core.js';
export declare class ASTParser {
    private static readonly IMPORT_PATTERNS;
    private static readonly EXPORT_PATTERNS;
    static parse(content: string, language: string, filePath: string): ASTNode[];
    private static extractImports;
    private static extractExports;
}
//# sourceMappingURL=ast_parser.d.ts.map
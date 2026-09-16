import type ts from "typescript";

export interface SemanticIssue {
  type:
    | "type-error"
    | "unused-variable"
    | "missing-import"
    | "circular-dependency";

  message: string;
  file: string;
  line: number;
  column: number;
  severity: "error" | "warning" | "info";
  suggestedFix?: string;
}

export interface ASTValidationResult {
  isValid: boolean;
  errors: ts.Diagnostic[];
  warnings: ts.Diagnostic[];
  syntaxTree: ts.SourceFile | null;
  semanticIssues: SemanticIssue[];
}

export interface CompilerError {
  file: string;
  line: number;
  column: number;
  message: string;
  code: number;
  category: ts.DiagnosticCategory;
  source: string;
  relatedInformation?: ts.DiagnosticRelatedInformation[];
}

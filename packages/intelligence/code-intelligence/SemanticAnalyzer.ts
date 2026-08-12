import * as ts from "typescript";
import { IntelligenceLogger } from "./logger.js";
import { SemanticIssue } from "./types.js";

export class SemanticAnalyzer {
  private logger: IntelligenceLogger;

  constructor() {
    this.logger = new IntelligenceLogger("SemanticAnalyzer");
  }

  public analyze(
    sourceFile: ts.SourceFile
  ): SemanticIssue[] {

    const issues: SemanticIssue[] = [];

    this.logger.debug(
      "Running semantic analysis",
      {
        file: sourceFile.fileName
      }
    );

    this.walk(sourceFile, issues);

    return issues;
  }

  private walk(
    node: ts.Node,
    issues: SemanticIssue[]
  ): void {

    if (ts.isImportDeclaration(node)) {
      const moduleName =
        node.moduleSpecifier.getText();

      if (!moduleName) {
        issues.push({
          type: "missing-import",
          message: "Invalid import declaration",
          file: node.getSourceFile().fileName,
          line: 0,
          column: 0,
          severity: "error"
        });
      }
    }

    ts.forEachChild(
      node,
      child => this.walk(child, issues)
    );
  }
}

import * as ts from "typescript";
import { IntelligenceLogger } from "./logger.js";

export interface CodeSymbol {
  name: string;
  kind: string;
  file: string;
  line: number;
}

export class SymbolIndexer {

  private logger: IntelligenceLogger;

  constructor() {
    this.logger = new IntelligenceLogger(
      "SymbolIndexer"
    );
  }

  public index(
    sourceFile: ts.SourceFile
  ): CodeSymbol[] {

    const symbols: CodeSymbol[] = [];

    this.logger.debug(
      "Indexing source symbols",
      {
        file: sourceFile.fileName
      }
    );

    this.walk(
      sourceFile,
      symbols
    );

    return symbols;
  }


  private walk(
    node: ts.Node,
    symbols: CodeSymbol[]
  ): void {

    if (
      ts.isFunctionDeclaration(node) &&
      node.name
    ) {
      symbols.push({
        name: node.name.text,
        kind: "function",
        file: node.getSourceFile().fileName,
        line:
          node.getSourceFile()
            .getLineAndCharacterOfPosition(
              node.getStart()
            ).line + 1
      });
    }


    if (
      ts.isClassDeclaration(node) &&
      node.name
    ) {
      symbols.push({
        name: node.name.text,
        kind: "class",
        file: node.getSourceFile().fileName,
        line:
          node.getSourceFile()
            .getLineAndCharacterOfPosition(
              node.getStart()
            ).line + 1
      });
    }


    ts.forEachChild(
      node,
      child =>
        this.walk(child, symbols)
    );
  }
}

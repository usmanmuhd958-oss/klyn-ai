import { createHash } from "node:crypto";
import * as ts from "typescript";

export type AstMutation =
  | RenameIdentifierMutation
  | ReplaceStringLiteralMutation
  | ReplaceFunctionBodyMutation
  | AddImportMutation
  | RemoveImportMutation;

export interface RenameIdentifierMutation {
  readonly kind: "rename-identifier";
  readonly from: string;
  readonly to: string;
}

export interface ReplaceStringLiteralMutation {
  readonly kind: "replace-string-literal";
  readonly from: string;
  readonly to: string;
}

export interface ReplaceFunctionBodyMutation {
  readonly kind: "replace-function-body";
  readonly functionName: string;
  /**
   * Statements placed inside the target function body.
   * The fragment must be syntactically valid TypeScript statements.
   */
  readonly body: string;
}

export interface AddImportMutation {
  readonly kind: "add-import";
  readonly moduleSpecifier: string;
  readonly defaultImport?: string;
  readonly namespaceImport?: string;
  readonly namedImports?: readonly string[];
  readonly typeOnly?: boolean;
}

export interface RemoveImportMutation {
  readonly kind: "remove-import";
  readonly moduleSpecifier: string;
}

export interface AstTextEdit {
  readonly mutationIndex: number;
  readonly start: number;
  readonly end: number;
  readonly replacement: string;
}

export interface AstMutationResult {
  readonly source: string;
  readonly sourceHash: string;
  readonly changed: boolean;
  readonly edits: readonly AstTextEdit[];
}

export class AstMutationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "AstMutationError";
  }
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function scriptKindFor(fileName: string): ts.ScriptKind {
  if (fileName.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (fileName.endsWith(".jsx")) return ts.ScriptKind.JSX;
  if (fileName.endsWith(".js") || fileName.endsWith(".mjs") || fileName.endsWith(".cjs")) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

function parseSource(fileName: string, source: string): ts.SourceFile {
  const parsed = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKindFor(fileName),
  );
  if (parsed.parseDiagnostics.length > 0) {
    const message = ts.flattenDiagnosticMessageText(
      parsed.parseDiagnostics[0]?.messageText ?? "Invalid source",
      "\n",
    );
    throw new AstMutationError(`Cannot mutate syntactically invalid source: ${message}`);
  }
  return parsed;
}

function requireIdentifier(value: string, field: string): void {
  if (!/^[$A-Z_a-z][$\w]*$/.test(value)) {
    throw new AstMutationError(`${field} must be a valid identifier`);
  }
}

function importStatement(mutation: AddImportMutation): string {
  if (!mutation.moduleSpecifier.trim()) {
    throw new AstMutationError("moduleSpecifier must be non-empty");
  }

  const bindings: string[] = [];
  if (mutation.defaultImport) {
    requireIdentifier(mutation.defaultImport, "defaultImport");
    bindings.push(mutation.defaultImport);
  }
  if (mutation.namespaceImport) {
    requireIdentifier(mutation.namespaceImport, "namespaceImport");
    bindings.push(`* as ${mutation.namespaceImport}`);
  }
  const named = [...(mutation.namedImports ?? [])];
  for (const name of named) requireIdentifier(name, "namedImports entry");
  if (named.length > 0) bindings.push(`{ ${named.join(", ")} }`);

  const moduleLiteral = JSON.stringify(mutation.moduleSpecifier);
  const prefix = mutation.typeOnly ? "import type" : "import";
  if (bindings.length === 0) return `import ${moduleLiteral};\n`;
  return `${prefix} ${bindings.join(", ")} from ${moduleLiteral};\n`;
}

function insertionPoint(sourceFile: ts.SourceFile, source: string): number {
  const imports = sourceFile.statements.filter(ts.isImportDeclaration);
  if (imports.length > 0) {
    return imports[imports.length - 1]!.end;
  }

  let position = source.startsWith("#!") ? (source.indexOf("\n") + 1) : 0;
  if (position === 0 && source.startsWith("#!")) position = source.length;

  for (const statement of sourceFile.statements) {
    if (
      ts.isExpressionStatement(statement) &&
      ts.isStringLiteral(statement.expression)
    ) {
      position = statement.end;
      continue;
    }
    break;
  }
  return position;
}

function removeTrailingNewline(source: string, end: number): number {
  if (source.startsWith("\r\n", end)) return end + 2;
  if (source.startsWith("\n", end) || source.startsWith("\r", end)) return end + 1;
  return end;
}

function collectRenameEdits(
  sourceFile: ts.SourceFile,
  mutation: RenameIdentifierMutation,
  mutationIndex: number,
): AstTextEdit[] {
  requireIdentifier(mutation.from, "from");
  requireIdentifier(mutation.to, "to");
  const edits: AstTextEdit[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && node.text === mutation.from) {
      edits.push({ mutationIndex, start: node.getStart(sourceFile), end: node.end, replacement: mutation.to });
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  if (edits.length === 0) throw new AstMutationError(`Identifier not found: ${mutation.from}`);
  return edits;
}

function collectStringEdits(
  sourceFile: ts.SourceFile,
  mutation: ReplaceStringLiteralMutation,
  mutationIndex: number,
): AstTextEdit[] {
  if (mutation.from.length === 0) {
    throw new AstMutationError("String literal source cannot be empty");
  }
  const replacement = JSON.stringify(mutation.to);
  const edits: AstTextEdit[] = [];
  const visit = (node: ts.Node): void => {
    if (
      (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) &&
      node.text === mutation.from
    ) {
      edits.push({ mutationIndex, start: node.getStart(sourceFile), end: node.end, replacement });
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  if (edits.length === 0) throw new AstMutationError(`String literal not found: ${mutation.from}`);
  return edits;
}

function functionName(node: ts.Node): string | undefined {
  if (!(
    ts.isFunctionDeclaration(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node) ||
    ts.isConstructorDeclaration(node)
  )) {
    return undefined;
  }
  if (ts.isConstructorDeclaration(node)) return "constructor";
  return node.name && ts.isIdentifier(node.name) ? node.name.text : undefined;
}

function renderBodyFragment(body: string): string {
  const wrapper = `function __klynMutationTarget() {\n${body}\n}`;
  const file = parseSource("__klyn_mutation_body.ts", wrapper);
  const declaration = file.statements[0];
  if (!declaration || !ts.isFunctionDeclaration(declaration) || !declaration.body) {
    throw new AstMutationError("Unable to parse function body mutation");
  }
  return declaration.body.getText(file);
}

function collectFunctionBodyEdits(
  sourceFile: ts.SourceFile,
  mutation: ReplaceFunctionBodyMutation,
  mutationIndex: number,
): AstTextEdit[] {
  if (!mutation.functionName.trim()) throw new AstMutationError("functionName must be non-empty");
  const replacement = renderBodyFragment(mutation.body);
  const edits: AstTextEdit[] = [];
  const visit = (node: ts.Node): void => {
    if (functionName(node) === mutation.functionName) {
      const body = (
        ts.isFunctionDeclaration(node) ||
        ts.isMethodDeclaration(node) ||
        ts.isGetAccessorDeclaration(node) ||
        ts.isSetAccessorDeclaration(node) ||
        ts.isConstructorDeclaration(node)
      ) ? node.body : undefined;

      if (body) {
        edits.push({ mutationIndex, start: body.getStart(sourceFile), end: body.end, replacement });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  if (edits.length === 0) {
    throw new AstMutationError(`Function with body not found: ${mutation.functionName}`);
  }
  if (edits.length > 1) {
    throw new AstMutationError(`Function name is ambiguous: ${mutation.functionName}`);
  }
  return edits;
}

function collectAddImportEdit(
  sourceFile: ts.SourceFile,
  source: string,
  mutation: AddImportMutation,
  mutationIndex: number,
): AstTextEdit[] {
  const existing = sourceFile.statements.find(
    (statement) =>
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      statement.moduleSpecifier.text === mutation.moduleSpecifier,
  );
  if (existing) {
    throw new AstMutationError(`Import already exists: ${mutation.moduleSpecifier}`);
  }
  return [{
    mutationIndex,
    start: insertionPoint(sourceFile, source),
    end: insertionPoint(sourceFile, source),
    replacement: importStatement(mutation),
  }];
}

function collectRemoveImportEdit(
  sourceFile: ts.SourceFile,
  source: string,
  mutation: RemoveImportMutation,
  mutationIndex: number,
): AstTextEdit[] {
  const existing = sourceFile.statements.find(
    (statement) =>
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      statement.moduleSpecifier.text === mutation.moduleSpecifier,
  );
  if (!existing) throw new AstMutationError(`Import not found: ${mutation.moduleSpecifier}`);
  return [{
    mutationIndex,
    start: existing.getStart(sourceFile),
    end: removeTrailingNewline(source, existing.end),
    replacement: "",
  }];
}

function assertNoOverlaps(edits: readonly AstTextEdit[]): void {
  const ordered = [...edits].sort((a, b) => a.start - b.start || a.end - b.end);
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1]!;
    const current = ordered[index]!;
    if (current.start < previous.end || (current.start === previous.start && current.end === previous.end)) {
      throw new AstMutationError(
        `Overlapping AST mutations at offsets ${String(previous.start)}-${String(previous.end)} and ${String(current.start)}-${String(current.end)}`,
      );
    }
  }
}

function applyEdits(source: string, edits: readonly AstTextEdit[]): string {
  const ordered = [...edits].sort((a, b) => b.start - a.start || b.end - a.end);
  let result = source;
  for (const edit of ordered) {
    result = result.slice(0, edit.start) + edit.replacement + result.slice(edit.end);
  }
  return result;
}

export class AstMutationEngine {
  public plan(fileName: string, source: string, mutations: readonly AstMutation[]): readonly AstTextEdit[] {
    const sourceFile = parseSource(fileName, source);
    if (mutations.length === 0) return [];

    const edits = mutations.flatMap((mutation, index) => {
      switch (mutation.kind) {
        case "rename-identifier":
          return collectRenameEdits(sourceFile, mutation, index);
        case "replace-string-literal":
          return collectStringEdits(sourceFile, mutation, index);
        case "replace-function-body":
          return collectFunctionBodyEdits(sourceFile, mutation, index);
        case "add-import":
          return collectAddImportEdit(sourceFile, source, mutation, index);
        case "remove-import":
          return collectRemoveImportEdit(sourceFile, source, mutation, index);
        default: {
          const exhaustive: never = mutation;
          throw new AstMutationError(`Unsupported AST mutation: ${String(exhaustive)}`);
        }
      }
    });

    assertNoOverlaps(edits);
    return Object.freeze([...edits]);
  }

  public apply(fileName: string, source: string, mutations: readonly AstMutation[]): AstMutationResult {
    const sourceHash = sha256(source);
    if (mutations.length === 0) {
      return Object.freeze({ source, sourceHash, changed: false, edits: Object.freeze([]) });
    }

    const edits = this.plan(fileName, source, mutations);
    const result = applyEdits(source, edits);
    parseSource(fileName, result);
    return Object.freeze({
      source: result,
      sourceHash: sha256(result),
      changed: result !== source,
      edits: Object.freeze([...edits]),
    });
  }
}

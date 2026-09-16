import { parse } from "@babel/parser";

export interface CodeGraphSourceFile {
  readonly path: string;
  readonly content: string;
}

export interface CodeGraphEdge {
  readonly from: string;
  readonly to: string;
  readonly specifier: string;
  readonly kind: "import" | "export" | "dynamic-import";
  readonly line: number;
  readonly column: number;
}

export interface CodeGraphNode {
  readonly path: string;
  readonly imports: readonly string[];
  readonly outgoing: readonly CodeGraphEdge[];
}

export interface CodeGraphSemanticAnchor {
  readonly kind: "semantic";
  readonly label: string;
  readonly start: number;
  readonly end: number;
}

export interface CodeGraphIndex {
  readonly nodes: readonly CodeGraphNode[];
  readonly edges: readonly CodeGraphEdge[];
  readonly anchors: readonly CodeGraphSemanticAnchor[];
}

class CodeGraphParseError extends Error {
  constructor(path: string, cause: unknown) {
    super(`Unable to parse ${path}: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = "CodeGraphParseError";
  }
}

interface AstLocation {
  readonly loc?: {
    readonly start?: {
      readonly line?: number;
      readonly column?: number;
    };
  };
}

type AstRecord = Record<string, unknown> & AstLocation;

const asRecord = (value: unknown): AstRecord | null => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as AstRecord;
};

const sourceValue = (value: unknown): string | null => {
  const record = asRecord(value);
  const nested = record?.value;
  return typeof nested === "string" ? nested : null;
};

const locationOf = (node: AstRecord): { readonly line: number; readonly column: number } => ({
  line: Number(node.loc?.start?.line ?? 1),
  column: Number(node.loc?.start?.column ?? 0),
});

const collectEdges = (ast: { readonly program: unknown }): readonly {
  readonly specifier: string;
  readonly kind: "import" | "export" | "dynamic-import";
  readonly line: number;
  readonly column: number;
}[] => {
  const collected: {
    specifier: string;
    kind: "import" | "export" | "dynamic-import";
    line: number;
    column: number;
  }[] = [];

  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    const node = asRecord(value);
    if (!node) return;

    if (node.type === "ImportDeclaration") {
      const specifier = sourceValue(node.source);
      if (specifier) collected.push({ ...locationOf(node), specifier, kind: "import" });
    } else if (node.type === "ExportNamedDeclaration" || node.type === "ExportAllDeclaration") {
      const specifier = sourceValue(node.source);
      if (specifier) collected.push({ ...locationOf(node), specifier, kind: "export" });
    } else if (node.type === "CallExpression") {
      const callee = asRecord(node.callee);
      const argumentsList = node.arguments;
      if (callee?.type === "Import" && Array.isArray(argumentsList)) {
        const first = sourceValue(argumentsList[0]);
        if (first) collected.push({ ...locationOf(node), specifier: first, kind: "dynamic-import" });
      }
    }

    for (const child of Object.values(node)) visit(child);
  };

  visit(ast.program);
  return collected.sort((left, right) =>
    `${left.line}:${left.column}:${left.kind}:${left.specifier}`.localeCompare(
      `${right.line}:${right.column}:${right.kind}:${right.specifier}`,
    ),
  );
};

const resolveSpecifier = (from: string, specifier: string, knownPaths: ReadonlySet<string>): string => {
  if (!specifier.startsWith(".")) return `external:${specifier}`;
  const slash = from.lastIndexOf("/");
  const baseDirectory = slash >= 0 ? from.slice(0, slash) : "";
  const raw = `${baseDirectory}/${specifier}`.replace(/\/+/g, "/");
  const normalized = raw.split("/").filter((part) => part !== ".").reduce<string[]>((parts, part) => {
    if (part === "..") parts.pop();
    else parts.push(part);
    return parts;
  }, []).join("/");
  const candidates = [
    normalized,
    `${normalized}.ts`,
    `${normalized}.tsx`,
    `${normalized}.js`,
    `${normalized}.jsx`,
    `${normalized}/index.ts`,
    `${normalized}/index.tsx`,
    `${normalized}/index.js`,
    `${normalized}/index.jsx`,
  ];
  return candidates.find((candidate) => knownPaths.has(candidate)) ?? normalized;
};

export class CodeGraphIndexer {
  index(files: readonly CodeGraphSourceFile[]): CodeGraphIndex {
    const sortedFiles = [...files].sort((left, right) => left.path.localeCompare(right.path));
    const knownPaths = new Set(sortedFiles.map((file) => file.path));
    const edges: CodeGraphEdge[] = [];
    const nodes: CodeGraphNode[] = [];

    for (const file of sortedFiles) {
      let ast: { readonly program: unknown };
      try {
        ast = parse(file.content, {
          sourceType: "unambiguous",
          errorRecovery: false,
          plugins: ["typescript", "jsx", "dynamicImport", "importMeta"],
        });
      } catch (error) {
        throw new CodeGraphParseError(file.path, error);
      }

      const rawEdges = collectEdges(ast);
      const outgoing = rawEdges.map((edge) => Object.freeze({
        from: file.path,
        to: resolveSpecifier(file.path, edge.specifier, knownPaths),
        specifier: edge.specifier,
        kind: edge.kind,
        line: edge.line,
        column: edge.column,
      }));
      nodes.push(Object.freeze({
        path: file.path,
        imports: [...new Set(outgoing.map((edge) => edge.to))].sort(),
        outgoing,
      }));
      edges.push(...outgoing);
    }

    const finalEdges = edges.sort((left, right) =>
      `${left.from}:${left.line}:${left.column}:${left.kind}:${left.to}`.localeCompare(
        `${right.from}:${right.line}:${right.column}:${right.kind}:${right.to}`,
      ),
    );
    const anchors: CodeGraphSemanticAnchor[] = finalEdges.map((edge) => Object.freeze({
      kind: "semantic",
      label: `${edge.from} -> ${edge.to} [${edge.kind}]`,
      start: Math.max(0, edge.line - 1),
      end: Math.max(0, edge.line - 1),
    }));

    return Object.freeze({
      nodes: nodes.sort((left, right) => left.path.localeCompare(right.path)),
      edges: finalEdges,
      anchors: anchors.sort((left, right) => `${left.label}:${left.start}`.localeCompare(`${right.label}:${right.start}`)),
    });
  }
}

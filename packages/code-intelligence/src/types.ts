export type CodeLanguage =
  | "typescript"
  | "javascript"
  | "python"
  | "rust"
  | "go"
  | "unknown";

export interface CodeFile {
  path: string;
  language: CodeLanguage;
  size: number;
}

export interface CodeSymbol {
  name: string;
  kind: string;
  file: string;
  line: number;
}

export interface DependencyGraph {
  nodes: string[];
  edges: {
    from: string;
    to: string;
  }[];
}

export interface CodeInsight {
  id: string;
  type:
    | "bug-risk"
    | "optimization"
    | "refactor"
    | "security";
  message: string;
  confidence: number;
}

// [KLYN-AST-GUARD] Verified & Protected by Klyn OS Kernel
// src/parser/language_detector.ts
export class LanguageDetector {
  private static readonly EXTENSIONS: Record<string, string> = {
    '.ts': 'typescript',
    '.tsx': 'typescript',
    '.js': 'javascript',
    '.jsx': 'javascript',
    '.mjs': 'javascript',
    '.cjs': 'javascript',
    '.py': 'python',
    '.go': 'go',
    '.rs': 'rust',
    '.java': 'java',
    '.c': 'c',
    '.cpp': 'cpp',
    '.h': 'c',
    '.hpp': 'cpp',
    '.json': 'json',
    '.md': 'markdown',
    '.yaml': 'yaml',
    '.yml': 'yaml',
    '.toml': 'toml',
    '.sh': 'shell',
    '.bash': 'shell',
  };
  
  static detect(filename: string): string | undefined {
    const ext = filename.substring(filename.lastIndexOf('.'));
    return this.EXTENSIONS[ext.toLowerCase()];
  }
  
  static isSupported(filename: string): boolean {
    return this.detect(filename) !== undefined;
  }
}

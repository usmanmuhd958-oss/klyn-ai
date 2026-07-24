// src/parser/language_detector.ts
export class LanguageDetector {
    static EXTENSIONS = {
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
    static detect(filename) {
        const ext = filename.substring(filename.lastIndexOf('.'));
        return this.EXTENSIONS[ext.toLowerCase()];
    }
    static isSupported(filename) {
        return this.detect(filename) !== undefined;
    }
}
//# sourceMappingURL=language_detector.js.map
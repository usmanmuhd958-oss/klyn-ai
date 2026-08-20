import { describe, it, expect } from 'vitest';
import { ASTParser } from '../../src/parser/ast_parser.js';

describe('ASTParser.parse', () => {
  it('returns a single module node describing the file', () => {
    const content = "import { a } from './a.js';\n";
    const nodes = ASTParser.parse(content, 'typescript', 'src/core/kernel.ts');

    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({
      id: 'src/core/kernel.ts',
      type: 'module',
      name: 'kernel.ts',
      range: [0, content.length],
    });
  });

  it('falls back to the full path as name when there is no directory', () => {
    expect(ASTParser.parse('', 'typescript', 'index.ts')[0].name).toBe('index.ts');
  });

  it('returns empty dependencies and exports for an unknown language', () => {
    const [node] = ASTParser.parse("import x from 'y';", 'cobol', 'a.cob');
    expect(node.dependencies).toEqual([]);
    expect(node.exports).toEqual([]);
  });
});

describe('ASTParser typescript imports', () => {
  it('extracts named, namespace, default and dynamic imports plus re-exports', () => {
    const content = [
      "import { a, b } from './named.js';",
      "import * as ns from 'namespace-pkg';",
      "import def from './default.js';",
      "const lazy = await import('./dynamic.js');",
      "export { c } from './reexport.js';",
      "export * from './star.js';",
    ].join('\n');

    const [node] = ASTParser.parse(content, 'typescript', 'a.ts');

    expect(node.dependencies).toEqual(
      expect.arrayContaining([
        './named.js',
        'namespace-pkg',
        './default.js',
        './dynamic.js',
        './reexport.js',
        './star.js',
      ])
    );
  });

  it('deduplicates repeated import sources', () => {
    const content = "import { a } from './dup.js';\nimport def from './dup.js';";
    const [node] = ASTParser.parse(content, 'typescript', 'a.ts');
    expect(node.dependencies.filter((d) => d === './dup.js')).toHaveLength(1);
  });

  it('ignores type-only syntax it cannot match and side-effect imports', () => {
    const [node] = ASTParser.parse("import './side-effect.js';", 'typescript', 'a.ts');
    expect(node.dependencies).toEqual([]);
  });
});

describe('ASTParser typescript exports', () => {
  it('extracts declaration, default and grouped exports', () => {
    const content = [
      'export const VERSION = 1;',
      'export function boot() {}',
      'export class Kernel {}',
      'export interface Options {}',
      'export type Id = string;',
      'export enum Mode { A }',
      'export default Kernel;',
      'export { boot, VERSION };',
    ].join('\n');

    const [node] = ASTParser.parse(content, 'typescript', 'a.ts');

    expect(node.exports).toEqual(
      expect.arrayContaining([
        'VERSION',
        'boot',
        'Kernel',
        'Options',
        'Id',
        'Mode',
      ])
    );
  });

  it('splits grouped exports on commas', () => {
    const [node] = ASTParser.parse('export { alpha, beta };', 'typescript', 'a.ts');
    expect(node.exports).toEqual(expect.arrayContaining(['alpha', 'beta']));
  });
});

describe('ASTParser javascript', () => {
  it('extracts require, import and dynamic import sources', () => {
    const content = [
      "const fs = require('node:fs');",
      "import path from 'node:path';",
      "const mod = await import('./mod.js');",
    ].join('\n');

    const [node] = ASTParser.parse(content, 'javascript', 'a.js');

    expect(node.dependencies).toEqual(
      expect.arrayContaining(['node:fs', 'node:path', './mod.js'])
    );
  });

  it('extracts module.exports members', () => {
    const [node] = ASTParser.parse('module.exports = { run, stop };', 'javascript', 'a.js');
    expect(node.exports).toEqual(expect.arrayContaining(['run', 'stop']));
  });
});

describe('ASTParser python', () => {
  it('extracts plain and from-imports anchored at line start', () => {
    const content = ['import os', 'from klyn.core import kernel', '    import indented'].join('\n');
    const [node] = ASTParser.parse(content, 'python', 'a.py');

    expect(node.dependencies).toEqual(expect.arrayContaining(['os', 'klyn.core']));
    expect(node.dependencies).not.toContain('indented');
  });

  it('reports no exports because python has no export patterns', () => {
    const [node] = ASTParser.parse('import os', 'python', 'a.py');
    expect(node.exports).toEqual([]);
  });
});

describe('ASTParser go', () => {
  it('extracts single-line imports', () => {
    const [node] = ASTParser.parse('import "fmt"', 'go', 'a.go');
    expect(node.dependencies).toContain('fmt');
  });

  it('splits grouped import blocks into individual packages', () => {
    const content = 'import (\n  "fmt"\n  "net/http"\n)';
    const [node] = ASTParser.parse(content, 'go', 'a.go');
    expect(node.dependencies).toEqual(expect.arrayContaining(['fmt', 'net/http']));
  });
});

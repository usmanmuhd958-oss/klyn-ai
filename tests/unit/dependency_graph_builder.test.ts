import { describe, it, expect, beforeEach } from 'vitest';
import { DependencyGraphBuilder } from '../../src/graph/dependency_graph.js';
import { HashEngine } from '../../src/core/hash.js';

describe('DependencyGraphBuilder.addFile', () => {
  let builder: DependencyGraphBuilder;

  beforeEach(() => {
    builder = new DependencyGraphBuilder();
  });

  it('returns the content hash and stores a node with parsed imports and exports', () => {
    const content = "import { b } from './b.ts';\nexport const a = 1;";
    const hash = builder.addFile('a.ts', content);

    expect(hash).toBe(HashEngine.hash(content));

    const node = builder.getNode('a.ts');
    expect(node?.path).toBe('a.ts');
    expect(node?.hash).toBe(hash);
    expect(node?.imports).toContain('./b.ts');
    expect(node?.exports).toContain('a');
    expect(node?.astNodes).toHaveLength(1);
  });

  it('stores no AST nodes for files of unsupported languages', () => {
    builder.addFile('notes.txt', "import { b } from './b.ts';");

    const node = builder.getNode('notes.txt');
    expect(node?.astNodes).toEqual([]);
    expect(node?.imports).toEqual([]);
  });

  it('overwrites the node when the same path is added again', () => {
    builder.addFile('a.ts', "import { b } from './b.ts';");
    builder.addFile('a.ts', "import { c } from './c.ts';");

    expect(builder.size()).toBe(1);
    expect(builder.getDependencies('a.ts')).toEqual(['./c.ts']);
  });

  it('returns undefined for an unknown node', () => {
    expect(builder.getNode('missing.ts')).toBeUndefined();
  });
});

describe('DependencyGraphBuilder edges', () => {
  let builder: DependencyGraphBuilder;

  beforeEach(() => {
    builder = new DependencyGraphBuilder();
    builder.addFile('a.ts', "import { b } from 'b.ts';");
    builder.addFile('b.ts', "import { c } from 'c.ts';");
    builder.addFile('c.ts', 'export const c = 1;');
  });

  it('lists direct dependencies', () => {
    expect(builder.getDependencies('a.ts')).toEqual(['b.ts']);
    expect(builder.getDependencies('c.ts')).toEqual([]);
  });

  it('returns an empty dependency list for an unknown path', () => {
    expect(builder.getDependencies('missing.ts')).toEqual([]);
  });

  it('finds direct dependents by scanning edges', () => {
    expect(builder.getDependents('b.ts')).toEqual(['a.ts']);
    expect(builder.getDependents('a.ts')).toEqual([]);
  });
});

describe('DependencyGraphBuilder.hasCircularDependency', () => {
  it('is false for an acyclic chain', () => {
    const builder = new DependencyGraphBuilder();
    builder.addFile('a.ts', "import { b } from 'b.ts';");
    builder.addFile('b.ts', 'export const b = 1;');

    expect(builder.hasCircularDependency('a.ts')).toBe(false);
  });

  it('detects a two-node cycle', () => {
    const builder = new DependencyGraphBuilder();
    builder.addFile('a.ts', "import { b } from 'b.ts';");
    builder.addFile('b.ts', "import { a } from 'a.ts';");

    expect(builder.hasCircularDependency('a.ts')).toBe(true);
  });

  it('detects a self referencing file', () => {
    const builder = new DependencyGraphBuilder();
    builder.addFile('a.ts', "import { a } from 'a.ts';");

    expect(builder.hasCircularDependency('a.ts')).toBe(true);
  });

  it('detects a cycle reachable further down the chain', () => {
    const builder = new DependencyGraphBuilder();
    builder.addFile('a.ts', "import { b } from 'b.ts';");
    builder.addFile('b.ts', "import { c } from 'c.ts';");
    builder.addFile('c.ts', "import { b } from 'b.ts';");

    expect(builder.hasCircularDependency('a.ts')).toBe(true);
  });

  it('is false for an unknown path', () => {
    expect(new DependencyGraphBuilder().hasCircularDependency('missing.ts')).toBe(false);
  });
});

describe('DependencyGraphBuilder.topologicalSort', () => {
  it('orders dependents before their dependencies', () => {
    const builder = new DependencyGraphBuilder();
    builder.addFile('a.ts', "import { b } from 'b.ts';");
    builder.addFile('b.ts', "import { c } from 'c.ts';");
    builder.addFile('c.ts', 'export const c = 1;');

    const order = builder.topologicalSort();

    expect(order).toHaveLength(3);
    expect(order.indexOf('a.ts')).toBeLessThan(order.indexOf('b.ts'));
    expect(order.indexOf('b.ts')).toBeLessThan(order.indexOf('c.ts'));
  });

  it('includes isolated files', () => {
    const builder = new DependencyGraphBuilder();
    builder.addFile('a.ts', 'export const a = 1;');
    builder.addFile('b.ts', 'export const b = 1;');

    expect(builder.topologicalSort().sort()).toEqual(['a.ts', 'b.ts']);
  });

  it('ignores imports of files that were never added', () => {
    const builder = new DependencyGraphBuilder();
    builder.addFile('a.ts', "import { x } from 'external-pkg';");

    expect(builder.topologicalSort()).toEqual(['a.ts']);
  });

  it('terminates on cyclic graphs', () => {
    const builder = new DependencyGraphBuilder();
    builder.addFile('a.ts', "import { b } from 'b.ts';");
    builder.addFile('b.ts', "import { a } from 'a.ts';");

    expect(builder.topologicalSort().sort()).toEqual(['a.ts', 'b.ts']);
  });

  it('returns an empty list for an empty graph', () => {
    expect(new DependencyGraphBuilder().topologicalSort()).toEqual([]);
  });
});

describe('DependencyGraphBuilder graph state', () => {
  it('exposes the underlying nodes and edges', () => {
    const builder = new DependencyGraphBuilder();
    builder.addFile('a.ts', "import { b } from 'b.ts';");

    const graph = builder.getGraph();
    expect(graph.nodes.has('a.ts')).toBe(true);
    expect(graph.edges.get('a.ts')?.has('b.ts')).toBe(true);
  });

  it('clears nodes and edges', () => {
    const builder = new DependencyGraphBuilder();
    builder.addFile('a.ts', "import { b } from 'b.ts';");
    builder.clear();

    expect(builder.size()).toBe(0);
    expect(builder.getDependencies('a.ts')).toEqual([]);
    expect(builder.getNode('a.ts')).toBeUndefined();
  });
});

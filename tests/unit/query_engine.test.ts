import { describe, it, expect, beforeEach } from 'vitest';
import { MerkleDAGEngine } from '../../src/core/merkle_dag.js';
import { DependencyGraphBuilder } from '../../src/graph/dependency_graph.js';
import { QueryEngine } from '../../src/query/query_engine.js';
import type { NodeMetadata } from '../../src/types/core.js';

const metadata = (path: string): NodeMetadata => ({
  path,
  size: 0,
  mtime: 0,
  type: 'file',
});

interface Harness {
  dag: MerkleDAGEngine;
  graph: DependencyGraphBuilder;
  engine: QueryEngine;
  index(path: string, content: string): string;
}

const harness = (): Harness => {
  const dag = new MerkleDAGEngine();
  const graph = new DependencyGraphBuilder();
  return {
    dag,
    graph,
    engine: new QueryEngine(dag, graph),
    index(path: string, content: string): string {
      graph.addFile(path, content);
      return dag.add(new TextEncoder().encode(content), metadata(path));
    },
  };
};

describe('QueryEngine.findByPath', () => {
  it('returns the dag node with its graph node and a perfect score', () => {
    const h = harness();
    h.index('a.ts', "import { b } from 'b.ts';");

    const result = h.engine.findByPath('a.ts');

    expect(result?.score).toBe(1);
    expect(result?.node.metadata.path).toBe('a.ts');
    expect(result?.graphNode?.imports).toContain('b.ts');
  });

  it('returns null for an unknown path', () => {
    expect(harness().engine.findByPath('missing.ts')).toBeNull();
  });

  it('returns the node without a graph node when only the dag knows the path', () => {
    const h = harness();
    h.dag.add(new TextEncoder().encode('x'), metadata('orphan.ts'));

    const result = h.engine.findByPath('orphan.ts');

    expect(result?.node.metadata.path).toBe('orphan.ts');
    expect(result?.graphNode).toBeUndefined();
  });
});

describe('QueryEngine.findByHash', () => {
  it('resolves a node and its graph node by hash', () => {
    const h = harness();
    const hash = h.index('a.ts', 'export const a = 1;');

    const result = h.engine.findByHash(hash);

    expect(result?.node.metadata.path).toBe('a.ts');
    expect(result?.graphNode?.exports).toContain('a');
  });

  it('returns null for an unknown hash', () => {
    expect(harness().engine.findByHash('missing')).toBeNull();
  });
});

describe('QueryEngine.findByContent', () => {
  it('matches case insensitively and returns the graph node', () => {
    const h = harness();
    h.index('a.ts', 'export function Boot() {}');

    const results = h.engine.findByContent('boot');

    expect(results).toHaveLength(1);
    expect(results[0].node.metadata.path).toBe('a.ts');
    expect(results[0].graphNode?.path).toBe('a.ts');
  });

  it('returns an empty list when nothing matches', () => {
    const h = harness();
    h.index('a.ts', 'export const a = 1;');

    expect(h.engine.findByContent('nonexistent')).toEqual([]);
  });

  it('ranks denser matches first', () => {
    const h = harness();
    h.index('dense.ts', 'kernel kernel');
    h.index('sparse.ts', `kernel${' '.repeat(200)}`);

    const results = h.engine.findByContent('kernel');

    expect(results.map((r) => r.node.metadata.path)).toEqual(['dense.ts', 'sparse.ts']);
    expect(results[0].score).toBeGreaterThan(results[1].score);
  });

  it('supports regex patterns', () => {
    const h = harness();
    h.index('a.ts', 'export const VERSION = 42;');

    expect(h.engine.findByContent('VERSION\\s*=\\s*\\d+')).toHaveLength(1);
  });
});

describe('QueryEngine.findDependencies', () => {
  let h: Harness;

  beforeEach(() => {
    h = harness();
    h.index('a.ts', "import { b } from 'b.ts';");
    h.index('b.ts', "import { c } from 'c.ts';");
    h.index('c.ts', 'export const c = 1;');
  });

  it('returns direct dependencies at the default depth', () => {
    expect([...h.engine.findDependencies('a.ts')]).toEqual(['b.ts']);
  });

  it('walks transitively up to the requested depth', () => {
    expect([...h.engine.findDependencies('a.ts', 2)].sort()).toEqual(['b.ts', 'c.ts']);
  });

  it('excludes the queried path itself', () => {
    expect(h.engine.findDependencies('a.ts', 99).has('a.ts')).toBe(false);
  });

  it('returns an empty set for a leaf or unknown file', () => {
    expect([...h.engine.findDependencies('c.ts')]).toEqual([]);
    expect([...h.engine.findDependencies('missing.ts')]).toEqual([]);
  });

  it('terminates on a cycle', () => {
    const cyclic = harness();
    cyclic.index('a.ts', "import { b } from 'b.ts';");
    cyclic.index('b.ts', "import { a } from 'a.ts';");

    expect([...cyclic.engine.findDependencies('a.ts', 99)]).toEqual(['b.ts']);
  });
});

describe('QueryEngine.findDependents', () => {
  let h: Harness;

  beforeEach(() => {
    h = harness();
    h.index('a.ts', "import { b } from 'b.ts';");
    h.index('b.ts', "import { c } from 'c.ts';");
    h.index('c.ts', 'export const c = 1;');
  });

  it('returns direct dependents at the default depth', () => {
    expect([...h.engine.findDependents('c.ts')]).toEqual(['b.ts']);
  });

  it('walks transitively up to the requested depth', () => {
    expect([...h.engine.findDependents('c.ts', 2)].sort()).toEqual(['a.ts', 'b.ts']);
  });

  it('returns an empty set for a root file', () => {
    expect([...h.engine.findDependents('a.ts')]).toEqual([]);
  });
});

describe('QueryEngine.getImpactAnalysis', () => {
  it('reports direct and transitive dependents', () => {
    const h = harness();
    h.index('a.ts', "import { b } from 'b.ts';");
    h.index('b.ts', "import { c } from 'c.ts';");
    h.index('c.ts', 'export const c = 1;');

    const impact = h.engine.getImpactAnalysis('c.ts');

    expect(impact.directDependents).toBe(1);
    expect(impact.totalDependents).toBe(2);
    expect(impact.affectedFiles.sort()).toEqual(['a.ts', 'b.ts']);
  });

  it('reports zero impact for an unknown file', () => {
    expect(harness().engine.getImpactAnalysis('missing.ts')).toEqual({
      directDependents: 0,
      totalDependents: 0,
      affectedFiles: [],
    });
  });
});

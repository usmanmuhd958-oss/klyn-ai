import { describe, it, expect, beforeEach } from 'vitest';
import { MerkleDAGEngine } from '../../src/core/merkle_dag.js';
import type { NodeMetadata } from '../../src/types/core.js';

const encode = (text: string): Uint8Array => new TextEncoder().encode(text);

const metadata = (path: string, overrides: Partial<NodeMetadata> = {}): NodeMetadata => ({
  path,
  size: 0,
  mtime: 0,
  type: 'file',
  ...overrides,
});

describe('MerkleDAGEngine.add', () => {
  let dag: MerkleDAGEngine;

  beforeEach(() => {
    dag = new MerkleDAGEngine();
  });

  it('stores a node retrievable by hash and by path', () => {
    const hash = dag.add(encode('content'), metadata('a.ts'));

    expect(dag.has(hash)).toBe(true);
    expect(dag.get(hash)?.metadata.path).toBe('a.ts');
    expect(dag.getByPath('a.ts')?.hash).toBe(hash);
  });

  it('deduplicates identical content and links into one node', () => {
    const first = dag.add(encode('same'), metadata('a.ts'));
    const second = dag.add(encode('same'), metadata('b.ts'));

    expect(second).toBe(first);
    expect(dag.size()).toBe(1);
    expect(dag.getByPath('b.ts')?.hash).toBe(first);
  });

  it('derives the same hash regardless of link order', () => {
    const left = dag.add(encode('c'), metadata('a.ts'), ['x', 'y']);
    const right = new MerkleDAGEngine().add(encode('c'), metadata('a.ts'), ['y', 'x']);

    expect(left).toBe(right);
  });

  it('stores links sorted', () => {
    const hash = dag.add(encode('c'), metadata('a.ts'), ['z', 'a']);

    expect(dag.getLinks(hash)).toEqual(['a', 'z']);
  });

  it('copies metadata so later caller mutations do not leak in', () => {
    const meta = metadata('a.ts');
    const hash = dag.add(encode('c'), meta);
    meta.path = 'mutated.ts';

    expect(dag.get(hash)?.metadata.path).toBe('a.ts');
  });

  it('produces distinct hashes for different content', () => {
    expect(dag.add(encode('one'), metadata('a.ts'))).not.toBe(
      dag.add(encode('two'), metadata('b.ts'))
    );
  });
});

describe('MerkleDAGEngine lookups', () => {
  it('returns undefined for unknown hashes and paths', () => {
    const dag = new MerkleDAGEngine();

    expect(dag.get('missing')).toBeUndefined();
    expect(dag.getByPath('missing.ts')).toBeUndefined();
    expect(dag.has('missing')).toBe(false);
    expect(dag.getLinks('missing')).toEqual([]);
  });

  it('reports size and all hashes', () => {
    const dag = new MerkleDAGEngine();
    const a = dag.add(encode('a'), metadata('a.ts'));
    const b = dag.add(encode('b'), metadata('b.ts'));

    expect(dag.size()).toBe(2);
    expect(dag.getAllHashes().sort()).toEqual([a, b].sort());
  });

  it('clears nodes and path index', () => {
    const dag = new MerkleDAGEngine();
    dag.add(encode('a'), metadata('a.ts'));
    dag.clear();

    expect(dag.size()).toBe(0);
    expect(dag.getByPath('a.ts')).toBeUndefined();
  });
});

describe('MerkleDAGEngine.update', () => {
  it('replaces the old node with a rehashed node keeping the metadata', () => {
    const dag = new MerkleDAGEngine();
    const oldHash = dag.add(encode('v1'), metadata('a.ts', { size: 2 }));
    const newHash = dag.update(oldHash, encode('v2'), []);

    expect(newHash).not.toBe(oldHash);
    expect(dag.has(oldHash)).toBe(false);
    expect(dag.size()).toBe(1);
    expect(dag.getByPath('a.ts')?.hash).toBe(newHash);
    expect(dag.get(newHash)?.metadata.size).toBe(2);
  });

  it('carries the new links over', () => {
    const dag = new MerkleDAGEngine();
    const oldHash = dag.add(encode('v1'), metadata('a.ts'));
    const newHash = dag.update(oldHash, encode('v2'), ['dep-b', 'dep-a']);

    expect(dag.getLinks(newHash)).toEqual(['dep-a', 'dep-b']);
  });

  it('throws for an unknown hash', () => {
    const dag = new MerkleDAGEngine();
    expect(() => dag.update('missing', encode('v2'), [])).toThrow(/missing/);
  });
});

describe('MerkleDAGEngine.traverse', () => {
  it('yields the root then linked nodes breadth first', () => {
    const dag = new MerkleDAGEngine();
    const child = dag.add(encode('child'), metadata('child.ts'));
    const root = dag.add(encode('root'), metadata('root.ts'), [child]);

    const paths = [...dag.traverse(root)].map((node) => node.metadata.path);

    expect(paths).toEqual(['root.ts', 'child.ts']);
  });

  it('visits each node once when links form a cycle', () => {
    const dag = new MerkleDAGEngine();
    const a = dag.add(encode('a'), metadata('a.ts'));
    const b = dag.add(encode('b'), metadata('b.ts'), [a]);
    // Re-add a pointing back to b, forming a cycle between the two stored nodes.
    const aCyclic = dag.add(encode('a-cyclic'), metadata('a2.ts'), [b]);

    const visited = [...dag.traverse(aCyclic)].map((node) => node.metadata.path);

    expect(new Set(visited).size).toBe(visited.length);
    expect(visited).toContain('b.ts');
  });

  it('skips links that reference unknown hashes', () => {
    const dag = new MerkleDAGEngine();
    const root = dag.add(encode('root'), metadata('root.ts'), ['does-not-exist']);

    expect([...dag.traverse(root)]).toHaveLength(1);
  });

  it('yields nothing for an unknown root', () => {
    expect([...new MerkleDAGEngine().traverse('missing')]).toHaveLength(0);
  });
});

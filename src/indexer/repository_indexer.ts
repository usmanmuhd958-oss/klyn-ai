// src/indexer/repository_indexer.ts
import type { IndexStats } from '../types/core.js';
import { MerkleDAGEngine } from '../core/merkle_dag.js';
import { DependencyGraphBuilder } from '../graph/dependency_graph.js';
import { FileScanner, type ScanOptions } from './file_scanner.js';
import { LanguageDetector } from '../parser/language_detector.js';

export class RepositoryIndexer {
  private dag: MerkleDAGEngine;
  private depGraph: DependencyGraphBuilder;

  constructor(
    dag: MerkleDAGEngine,
    depGraph: DependencyGraphBuilder
  ) {
    this.dag = dag;
    this.depGraph = depGraph;
  }

  async index(rootPath: string, options?: ScanOptions): Promise<IndexStats> {
    const startTime = performance.now();
    let filesIndexed = 0;
    let nodesCreated = 0;
    let totalSize = 0;

    const fileMap = new Map<string, string>();

    // Using zero-copy generator from FileScanner
    for await (const { path, content, metadata } of FileScanner.scan(rootPath, options)) {
      const language = LanguageDetector.detect(path);
      if (language) {
        metadata.language = language;
      }

      // To avoid keeping the SharedArrayBuffer reference alive in DAG:
      // Copy content ONLY to the cryptographic hash generator, storing references.
      const persistentContent = new Uint8Array(content);
      const hash = this.dag.add(persistentContent, metadata);
      fileMap.set(path, hash);

      // Decoding directly without intermediate Buffer wrapping
      const contentStr = new TextDecoder('utf-8').decode(content);
      this.depGraph.addFile(path, contentStr);

      filesIndexed++;
      nodesCreated++;
      totalSize += metadata.size;
    }

    for (const [path, hash] of fileMap.entries()) {
      const deps = this.depGraph.getDependencies(path);
      const depHashes = deps
        .map(dep => this.resolveImport(dep, path, fileMap))
        .filter((h): h is string => h !== null);

      if (depHashes.length > 0) {
        const node = this.dag.get(hash);
        if (node) {
          const updated = this.dag.update(hash, node.data, depHashes);
          fileMap.set(path, updated);
        }
      }
    }

    const endTime = performance.now();

    return {
      filesIndexed,
      nodesCreated,
      totalSize,
      indexTime: endTime - startTime,
    };
  }

  private resolveImport(
    importPath: string,
    fromPath: string,
    fileMap: Map<string, string>
  ): string | null {
    if (importPath.startsWith('.')) {
      const dir = fromPath.substring(0, fromPath.lastIndexOf('/'));
      const resolved = this.normalizePath(join(dir, importPath));

      const candidates = [
        resolved,
        `${resolved}.ts`,
        `${resolved}.js`,
        `${resolved}.tsx`,
        `${resolved}.jsx`,
        `${resolved}/index.ts`,
        `${resolved}/index.js`,
      ];

      for (const candidate of candidates) {
        if (fileMap.has(candidate)) {
          return fileMap.get(candidate)!;
        }
      }
    }

    return null;
  }

  private normalizePath(path: string): string {
    const parts = path.split('/');
    const normalized: string[] = [];

    for (const part of parts) {
      if (part === '..') {
        normalized.pop();
      } else if (part !== '.' && part !== '') {
        normalized.push(part);
      }
    }

    return normalized.join('/');
  }
}

function join(...paths: string[]): string {
  return paths.join('/').replace(/\/+/g, '/');
}

// [KLYN-AST-GUARD] Verified & Protected by Klyn OS Kernel
// kernel/src/ast/impact_analyzer.ts
import type { ASTDependencyGraph } from './dependency_graph.js';

export interface ImpactAnalysis {
  directlyAffected: string[];
  transitivelyAffected: string[];
  totalAffected: number;
  maxDepth: number;
  affectedByDepth: Map<number, string[]>;
}

export interface ChangeImpact {
  file: string;
  depth: number;
  reason: 'direct' | 'transitive';
  throughFiles: string[];
}

export class ImpactAnalyzer {
  constructor(private graph: ASTDependencyGraph) {}

  analyzeFileChange(filePath: string): ImpactAnalysis {
    const directlyAffected = this.graph.getDirectDependencies(filePath);
    const allAffected = this.graph.getAllDependents(filePath);
    
    const affectedByDepth = new Map<number, string[]>();
    affectedByDepth.set(0, [filePath]);
    affectedByDepth.set(1, directlyAffected);
    
    const transitivelyAffected = Array.from(allAffected).filter(
      f => !directlyAffected.includes(f)
    );
    
    let currentDepth = 1;
    let currentLevel = new Set(directlyAffected);
    let visited = new Set([filePath, ...directlyAffected]);
    
    while (currentLevel.size > 0) {
      const nextLevel = new Set<string>();
      
      for (const file of currentLevel) {
        const dependents = this.graph.getDirectDependencies(file);
        
        for (const dep of dependents) {
          if (!visited.has(dep)) {
            nextLevel.add(dep);
            visited.add(dep);
          }
        }
      }
      
      if (nextLevel.size > 0) {
        currentDepth++;
        affectedByDepth.set(currentDepth, Array.from(nextLevel));
      }
      
      currentLevel = nextLevel;
    }
    
    return {
      directlyAffected,
      transitivelyAffected,
      totalAffected: allAffected.size,
      maxDepth: currentDepth,
      affectedByDepth,
    };
  }

  analyzeMultipleChanges(filePaths: string[]): ImpactAnalysis {
    const allDirectly = new Set<string>();
    const allTransitively = new Set<string>();
    const allAffected = new Set<string>();
    let maxDepth = 0;
    const affectedByDepth = new Map<number, Set<string>>();
    
    for (const file of filePaths) {
      const analysis = this.analyzeFileChange(file);
      
      analysis.directlyAffected.forEach(f => allDirectly.add(f));
      analysis.transitivelyAffected.forEach(f => allTransitively.add(f));
      maxDepth = Math.max(maxDepth, analysis.maxDepth);
      
      for (const [depth, files] of analysis.affectedByDepth.entries()) {
        if (!affectedByDepth.has(depth)) {
          affectedByDepth.set(depth, new Set());
        }
        files.forEach(f => affectedByDepth.get(depth)!.add(f));
      }
    }
    
    for (const f of allDirectly) allAffected.add(f);
    for (const f of allTransitively) allAffected.add(f);
    
    const finalByDepth = new Map<number, string[]>();
    for (const [depth, files] of affectedByDepth.entries()) {
      finalByDepth.set(depth, Array.from(files));
    }
    
    return {
      directlyAffected: Array.from(allDirectly),
      transitivelyAffected: Array.from(allTransitively),
      totalAffected: allAffected.size,
      maxDepth,
      affectedByDepth: finalByDepth,
    };
  }

  getChangeImpactDetails(filePath: string): ChangeImpact[] {
    const impacts: ChangeImpact[] = [];
    const paths = new Map<string, string[]>();
    
    const findPaths = (target: string, current: string[] = [filePath]) => {
      const node = this.graph.getFileNode(current[current.length - 1]);
      if (!node) return;
      
      for (const dependent of node.directDependents) {
        if (dependent === target) {
          paths.set(target, [...current, target]);
          return;
        }
        
        if (!current.includes(dependent)) {
          findPaths(target, [...current, dependent]);
        }
      }
    };
    
    const affected = this.graph.getAffectedFilesOnMutation(filePath);
    
    for (const file of affected) {
      findPaths(file);
      
      const throughFiles = paths.get(file) || [];
      const depth = throughFiles.length - 2;
      
      impacts.push({
        file,
        depth: Math.max(0, depth),
        reason: depth === 0 ? 'direct' : 'transitive',
        throughFiles: throughFiles.slice(1, -1),
      });
    }
    
    return impacts.sort((a, b) => a.depth - b.depth);
  }

  getCriticalFiles(threshold: number = 10): Array<{ file: string; dependentCount: number }> {
    const criticalFiles: Array<{ file: string; dependentCount: number }> = [];
    
    const allFiles = Array.from(this.graph['nodes'].keys());
    
    for (const file of allFiles) {
      const dependents = this.graph.getAllDependents(file);
      
      if (dependents.size >= threshold) {
        criticalFiles.push({
          file,
          dependentCount: dependents.size,
        });
      }
    }
    
    return criticalFiles.sort((a, b) => b.dependentCount - a.dependentCount);
  }
}

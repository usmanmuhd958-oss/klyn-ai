import {RepositoryScanner} from "./RepositoryScanner.js";
import {DependencyGraph} from "./DependencyGraph.js";
import {CodeKnowledgeMap} from "./CodeKnowledgeMap.js";
import {ArchitectureAnalyzer} from "./ArchitectureAnalyzer.js";
import {ChangeImpactEngine} from "./ChangeImpactEngine.js";


export class RepositoryRuntimeController {

  scanner=new RepositoryScanner();
  graph=new DependencyGraph();
  knowledge=new CodeKnowledgeMap();
  analyzer=new ArchitectureAnalyzer();
  impact=new ChangeImpactEngine();


  analyze(path:string){

    const repo=this.scanner.scan(path);

    const architecture=this.analyzer.analyze(repo);

    return {
      repo,
      architecture
    };

  }

}

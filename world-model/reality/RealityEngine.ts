import { ProjectState } from "../state/ProjectState";
import { DependencyGraph } from "../graph/DependencyGraph";


export type RealitySnapshot = {
  timestamp: number;
  entities: number;
  dependencies: number;
  health: "stable" | "warning" | "critical";
};


export class RealityEngine {

  constructor(
    private state: ProjectState,
    private graph: DependencyGraph
  ) {}


  observe(): RealitySnapshot {

    const entities =
      this.state.list().length;


    const dependencies =
      this.graph
        .getDependencies("*")
        .length;


    let health:
      | "stable"
      | "warning"
      | "critical" = "stable";


    if (dependencies > 1000)
      health = "warning";


    return {
      timestamp: Date.now(),
      entities,
      dependencies,
      health
    };
  }
}

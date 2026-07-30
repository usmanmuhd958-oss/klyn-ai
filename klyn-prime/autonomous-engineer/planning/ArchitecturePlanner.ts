export interface ArchitectureDecision {
  component: string;
  purpose: string;
  dependencies: string[];
}


export class ArchitecturePlanner {

  private decisions: ArchitectureDecision[] = [];


  analyze(component: string, purpose: string) {

    const decision: ArchitectureDecision = {
      component,
      purpose,
      dependencies: []
    };

    this.decisions.push(decision);

    return decision;
  }


  addDependency(
    component: string,
    dependency: string
  ) {

    const target = this.decisions.find(
      item => item.component === component
    );

    if (target) {
      target.dependencies.push(dependency);
    }
  }


  getArchitecture() {
    return this.decisions;
  }
}

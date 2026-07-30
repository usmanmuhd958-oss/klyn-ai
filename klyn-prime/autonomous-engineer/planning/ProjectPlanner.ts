export interface ProjectPlan {
  name: string;
  objectives: string[];
  phases: string[];
}


export class ProjectPlanner {

  private plans: ProjectPlan[] = [];


  create(plan: ProjectPlan) {
    this.plans.push(plan);
  }


  getPlans() {
    return this.plans;
  }


  generateRoadmap(name: string) {

    return {
      project: name,
      roadmap: [
        "Analysis",
        "Architecture",
        "Implementation",
        "Testing",
        "Deployment",
        "Optimization"
      ]
    };
  }
}

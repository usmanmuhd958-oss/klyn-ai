export interface IntelligenceTask {
  id: string;
  type: string;
  priority: number;
  context?: any;
}


export interface RoutingDecision {
  agent: string;
  capability: string;
  reason: string;
}


export class IntelligenceRouter {

  private routes: Map<string,string>;


  constructor(){

    this.routes = new Map();

    this.initializeRoutes();

  }



  private initializeRoutes(){

    this.routes.set(
      "code",
      "autonomous-engineer"
    );


    this.routes.set(
      "research",
      "research-intelligence"
    );


    this.routes.set(
      "planning",
      "prime-brain"
    );


    this.routes.set(
      "security",
      "governance-engine"
    );


  }



  route(
    task:IntelligenceTask
  ):RoutingDecision{


    const agent =
      this.routes.get(task.type)
      ||
      "general-intelligence-agent";


    return {

      agent,

      capability:task.type,

      reason:
      `Selected ${agent} for ${task.type} task`

    };


  }



  registerRoute(
    capability:string,
    agent:string
  ){

    this.routes.set(
      capability,
      agent
    );

  }



  listRoutes(){

    return Object.fromEntries(
      this.routes
    );

  }

}

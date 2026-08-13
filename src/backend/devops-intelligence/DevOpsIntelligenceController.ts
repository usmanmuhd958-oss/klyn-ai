import {DeploymentPlanner} from "./DeploymentPlanner.js";
import {InfrastructureAnalyzer} from "./InfrastructureAnalyzer.js";
import {ObservabilityEngine} from "./ObservabilityEngine.js";
import {IncidentResponseEngine} from "./IncidentResponseEngine.js";


export class DevOpsIntelligenceController {

  deployment = new DeploymentPlanner();

  infrastructure = new InfrastructureAnalyzer();

  observability = new ObservabilityEngine();

  incidents = new IncidentResponseEngine();


  analyze(request:any){

    return {

      deployment:
        this.deployment.plan(request.target),

      infrastructure:
        this.infrastructure.analyze(request.environment),

      observability:
        this.observability.inspect(request.system),

      incident:
        this.incidents.handle(request.event)

    };

  }

}

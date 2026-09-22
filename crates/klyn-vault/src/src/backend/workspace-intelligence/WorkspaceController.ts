import {WorkspaceSession} from "./WorkspaceSession.js";
import {ProjectContextManager} from "./ProjectContextManager.js";
import {AgentSessionManager} from "./AgentSessionManager.js";
import {IntelligenceStream} from "./IntelligenceStream.js";


export class WorkspaceController {


  projects = new ProjectContextManager();

  agents = new AgentSessionManager();

  stream = new IntelligenceStream();



  create(context:any){

    const session =
      new WorkspaceSession(context);


    return {

      session:session.info(),

      intelligence:
        this.stream.emit({
          type:"workspace-created"
        })

    };

  }


}

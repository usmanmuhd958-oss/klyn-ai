#!/usr/bin/env bash

set -e

echo "======================================"
echo " KLYN INTELLIGENCE WORKSPACE P1"
echo " WORKSPACE CORE ACTIVATION"
echo "======================================"

mkdir -p src/backend/workspace-intelligence


cat > src/backend/workspace-intelligence/WorkspaceContext.ts <<'TS'
export interface WorkspaceContext {

  workspaceId:string;

  projectId?:string;

  userId?:string;

  metadata?:any;

}
TS


cat > src/backend/workspace-intelligence/WorkspaceSession.ts <<'TS'
import {WorkspaceContext} from "./WorkspaceContext.js";


export class WorkspaceSession {

  constructor(
    public context:WorkspaceContext
  ){}


  info(){

    return {
      active:true,
      context:this.context
    };

  }

}
TS


cat > src/backend/workspace-intelligence/ProjectContextManager.ts <<'TS'
export class ProjectContextManager {


  private projects = new Map<string, any>();


  register(id:string, data:any){

    this.projects.set(id,data);

  }


  get(id:string){

    return this.projects.get(id);

  }

}
TS


cat > src/backend/workspace-intelligence/AgentSessionManager.ts <<'TS'
export class AgentSessionManager {


  private sessions:any[]=[];


  create(agent:any){

    this.sessions.push(agent);

    return agent;

  }


  list(){

    return this.sessions;

  }

}
TS


cat > src/backend/workspace-intelligence/IntelligenceStream.ts <<'TS'
export class IntelligenceStream {


  emit(event:any){

    return {

      timestamp:Date.now(),

      event

    };

  }


}
TS


cat > src/backend/workspace-intelligence/WorkspaceController.ts <<'TS'
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
TS


echo
echo "======================================"
echo " P1 INTELLIGENCE WORKSPACE READY"
echo "======================================"

npm run build


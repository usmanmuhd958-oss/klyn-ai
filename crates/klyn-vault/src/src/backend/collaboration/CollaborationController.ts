import { WorkspaceManager } from "./WorkspaceManager.js";
import { RealtimeSessionManager } from "./RealtimeSessionManager.js";


export class CollaborationController {


 workspace =
  new WorkspaceManager();


 sessions =
  new RealtimeSessionManager();


 status(){

  return {

   collaboration:"ONLINE"

  };

 }


}

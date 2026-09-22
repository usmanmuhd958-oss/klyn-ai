import {WorkspaceRuntime} from "./WorkspaceRuntime.js";


export class WorkspaceController {


 runtime=new WorkspaceRuntime();



 execute(action:any){

    if(action.type==="open-project"){

      return this.runtime.openProject(action.project);

    }


    if(action.type==="inspect-code"){

      return this.runtime.inspectCode(action.file);

    }


    return {

      status:"unknown-action"

    };


 }


}

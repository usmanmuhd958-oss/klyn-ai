import {ProjectSessionManager} from "./ProjectSessionManager.js";
import {CodeContextAPI} from "./CodeContextAPI.js";


export class WorkspaceRuntime {


 sessions=new ProjectSessionManager();

 context=new CodeContextAPI();



 openProject(project:string){

    return this.sessions.create(project);

 }



 inspectCode(file:string){

    return this.context.analyze(file);

 }


}

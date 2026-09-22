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

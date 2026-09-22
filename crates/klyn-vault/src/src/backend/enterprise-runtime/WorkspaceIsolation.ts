import {TenantContext} from "./TenantContext.js";


export class WorkspaceIsolation {


  validate(context:TenantContext){

    return {

      isolated:true,

      context

    };

  }


}

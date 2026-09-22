import {CapabilityRegistry} from "./CapabilityRegistry.js";
import {UnifiedContextManager} from "./UnifiedContextManager.js";
import {AgentCapabilityRouter} from "./AgentCapabilityRouter.js";


export class IntelligenceRuntime {


 registry=new CapabilityRegistry();

 context=new UnifiedContextManager();

 router=new AgentCapabilityRouter();



 execute(request:any){

   const context =
     this.context.build(request);


   const agent =
     this.router.route(context);



   return {

     context,

     agent,

     status:"intelligence-ready"

   };


 }


}

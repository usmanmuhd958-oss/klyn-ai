import { RequestRouter } from "./RequestRouter.js";
import { RequestPipeline } from "./RequestPipeline.js";
import { GatewayMonitor } from "./GatewayMonitor.js";


export class ApiGateway {


 router =
  new RequestRouter();


 pipeline =
  new RequestPipeline();


 monitor =
  new GatewayMonitor();



 handle(request:any){

  const processed =
   this.pipeline.execute(request);


  const route =
   this.router.route(request);


  return {

   processed,

   route,

   status:this.monitor.status()

  };


 }


}

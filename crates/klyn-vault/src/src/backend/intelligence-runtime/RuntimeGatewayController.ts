import {IntelligenceRuntime} from "./IntelligenceRuntime.js";


export class RuntimeGatewayController {


 runtime=new IntelligenceRuntime();



 handle(request:any){

   return this.runtime.execute(request);

 }


}

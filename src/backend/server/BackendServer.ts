import {RuntimeManager} from "../runtime/RuntimeManager.js";
import {ServiceRegistry} from "../services/ServiceRegistry.js";


export class BackendServer{

 runtime = new RuntimeManager();

 registry = new ServiceRegistry();


 start(){

   this.runtime.start();

   return {
    server:"ONLINE",
    runtime:this.runtime.health()
   };

 }

}

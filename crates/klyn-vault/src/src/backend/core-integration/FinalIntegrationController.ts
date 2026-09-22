import { KlynBackendKernel } from "./KlynBackendKernel.js";


export class FinalIntegrationController {

 kernel =
  new KlynBackendKernel();


 launch(){

  return this.kernel.boot();

 }

}

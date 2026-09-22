import {BackendKernelController} from "./BackendKernelController.js";


export class ProductionController {


  kernel = new BackendKernelController();


  launch(){

    return this.kernel.boot();

  }


}

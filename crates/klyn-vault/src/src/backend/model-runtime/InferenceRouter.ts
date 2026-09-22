import {ModelSelector} from "./ModelSelector.js";


export class InferenceRouter {

  selector = new ModelSelector();


  route(task:any){

    return this.selector.select(task);

  }

}

import {FuturePredictor} from "./FuturePredictor";


export class SimulationController {


predictor =
new FuturePredictor();


evaluate(change:string){

 return this.predictor.predict(change);

}


}

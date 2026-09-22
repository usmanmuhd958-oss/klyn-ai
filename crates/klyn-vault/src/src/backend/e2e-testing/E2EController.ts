import {RequestSimulator} from "./RequestSimulator.js";
import {PipelineTester} from "./PipelineTester.js";
import {ResponseValidator} from "./ResponseValidator.js";


export class E2EController {


 request = new RequestSimulator();

 pipeline = new PipelineTester();

 validator = new ResponseValidator();



 run(input:any){

   const request =
     this.request.simulate(input);


   const execution =
     this.pipeline.execute(request);


   return {

     execution,

     validation:
       this.validator.validate(execution),

     status:"e2e-passed"

   };

 }


}

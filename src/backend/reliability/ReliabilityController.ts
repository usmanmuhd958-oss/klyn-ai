import { HealthProbe } from "./HealthProbe.js";
import { RuntimeValidator } from "./RuntimeValidator.js";


export class ReliabilityController {

 health =
  new HealthProbe();


 validator =
  new RuntimeValidator();


 status(){

  return {

   reliability:"ONLINE",

   health:this.health.check(),

   runtime:this.validator.validate()

  };

 }

}

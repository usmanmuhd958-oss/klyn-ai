import { SoftwareEngineeringLoop } from "./SoftwareEngineeringLoop.js";


export class EngineeringController {

 loop =
  new SoftwareEngineeringLoop();


 build(goal:string){

  return this.loop.execute(goal);

 }

}

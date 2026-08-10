import { EngineeringObserver } from "./EngineeringObserver";
import { EngineeringPlanner } from "./EngineeringPlanner";
import { EngineeringExecutor } from "./EngineeringExecutor";
import { EngineeringVerifier } from "./EngineeringVerifier";

export class AutonomousEngineeringLoop {

 run(target:string){

   const observation =
    new EngineeringObserver().observe(target);

   const plan =
    new EngineeringPlanner().plan(observation);

   const result =
    new EngineeringExecutor().execute(plan);

   return new EngineeringVerifier()
    .verify(result);

 }

}

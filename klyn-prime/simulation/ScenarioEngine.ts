export interface Scenario {

 name:string;

 actions:string[];

}


export class ScenarioEngine {


simulate(
scenario:Scenario
){

 return {

   scenario:scenario.name,

   result:"simulated",

   actions:scenario.actions

 };

}


}

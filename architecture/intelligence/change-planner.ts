import { analyzeChange } from "./impact-analyzer";


export function createPlan(module:string){

 const impact = analyzeChange(module);

 if("error" in impact){
   return impact;
 }


 return {
   change_target: module,

   steps:[
    "Analyze dependencies",
    "Backup affected modules",
    "Apply migration",
    "Run architecture validation",
    "Run typecheck",
    "Record evolution"
   ],

   risk: impact.risk,

   affected_modules:
     impact.affected
 };
}


console.log(
 JSON.stringify(
  createPlan(process.argv[2]),
  null,
  2
 )
);

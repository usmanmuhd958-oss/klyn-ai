import fs from "node:fs";

const map = JSON.parse(
 fs.readFileSync(
 "architecture/graph/impact-map.json",
 "utf8"
 )
);


export function analyzeChange(module:string){

 const target =
 map.modules[module];

 if(!target){
   return {
    error:"Unknown module"
   };
 }

 return {
   module,
   risk:target.risk,
   affected:target.affected,
   recommendation:
    target.risk==="critical"
    ?"Require validation"
    :"Normal migration"
 };
}


console.log(
 analyzeChange(
  process.argv[2]
 )
);

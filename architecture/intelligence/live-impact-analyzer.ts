import fs from "node:fs";


const graph =
JSON.parse(
 fs.readFileSync(
 "architecture/graph/live-dependency-graph.json",
 "utf8"
 )
);


function findImpact(target:string){

 const matches =
 graph.imports.filter(
 (item:string)=>
 item.includes(target)
 );


 return {
   target,
   affected_count:matches.length,
   affected:matches
 };
}


console.log(
 JSON.stringify(
 findImpact(process.argv[2]),
 null,
 2
 )
);

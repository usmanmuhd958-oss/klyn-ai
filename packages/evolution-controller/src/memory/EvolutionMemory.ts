import fs from "node:fs";
import path from "node:path";


export interface EvolutionRecord {

 id:string;
 issue:string;
 action:string;
 risk:string;
 timestamp:number;

}


export class EvolutionMemory {

 private file =
 path.join(
 process.cwd(),
 "data/evolution/history.json"
 );


 private records:EvolutionRecord[] = [];


 constructor(){

   this.load();

 }


 save(record:EvolutionRecord){

   this.records.push(record);

   this.persist();

   return true;

 }


 getHistory(){

   return this.records;

 }


 find(issue:string){

   return this.records.filter(
     r=>r.issue===issue
   );

 }


 private persist(){

   fs.writeFileSync(
    this.file,
    JSON.stringify(
      this.records,
      null,
      2
    )
   );

 }


 private load(){

   if(fs.existsSync(this.file)){

    this.records =
    JSON.parse(
     fs.readFileSync(
       this.file,
       "utf8"
     )
    );

   }

 }


}

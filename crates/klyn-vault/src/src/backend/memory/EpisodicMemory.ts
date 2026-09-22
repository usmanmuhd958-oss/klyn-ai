export interface EpisodeRecord {

 id:string;

 event:string;

 context:any;

 timestamp:number;

}


export class EpisodicMemory {

 private records:EpisodeRecord[]=[];


 store(record:EpisodeRecord){

  this.records.push(record);

 }


 recall(){

  return this.records;

 }


}

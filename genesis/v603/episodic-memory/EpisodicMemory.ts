export class EpisodicMemory {

 episodes:any[]=[];

 record(event:any){

  this.episodes.push(event);

 }

}

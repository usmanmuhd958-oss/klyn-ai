export interface MemoryNode {
 id:string;
 label:string;
 category:
 "code"|
 "agent"|
 "decision"|
 "learning";

 importance:number;

 x:number;
 y:number;
}


export interface MemoryLink {
 source:string;
 target:string;
 relation:string;
}

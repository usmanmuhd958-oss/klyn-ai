export interface SpatialNode {
 id:string;
 name:string;
 type:
 "file"|
 "agent"|
 "service"|
 "module";

 x:number;
 y:number;

 metadata?:Record<string,unknown>;
}


export interface SpatialConnection {
 source:string;
 target:string;
 relation:string;
}

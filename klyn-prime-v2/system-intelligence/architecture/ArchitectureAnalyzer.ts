export interface ArchitectureReport {

 components:string[];

 patterns:string[];

 issues:string[];

}


export class ArchitectureAnalyzer {


 analyze(project:any):ArchitectureReport {


   return {

     components:[],

     patterns:[],

     issues:[]

   };


 }


}

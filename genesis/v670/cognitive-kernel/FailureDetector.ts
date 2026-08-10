export class FailureDetector {

 detect(health:any){

   return {
     failure:false,
     source:null,
     health
   };

 }

}

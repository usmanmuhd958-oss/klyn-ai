export class ErrorAnalyzer {


 analyze(error:any){

  return {

   type:error?.name || "UNKNOWN",

   message:error?.message || String(error)

  };

 }


}

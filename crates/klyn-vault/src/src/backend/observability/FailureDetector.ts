export class FailureDetector {


 detect(result:any){

  return {

   failed: result?.success === false

  };


 }


}

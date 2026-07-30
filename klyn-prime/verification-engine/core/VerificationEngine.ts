export interface VerificationResult {
  passed:boolean;
  score:number;
  issues:string[];
}


export class VerificationEngine {


verify(target:any):VerificationResult {

 return {
  passed:true,
  score:100,
  issues:[]
 };

}


}

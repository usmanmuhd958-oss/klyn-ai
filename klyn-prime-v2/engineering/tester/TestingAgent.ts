export interface TestResult {

 passed:boolean;

 issues:string[];

}


export class TestingAgent {


 run(code:string):TestResult {


   return {

     passed:true,

     issues:[]

   };


 }


}

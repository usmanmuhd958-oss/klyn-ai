export interface BugReport {

 error:string;

 location:string;

}


export class DebugAgent {


 analyze(bug:BugReport){


   return {

     cause:
       "Analyzing root cause",

     recommendation:
       "Apply corrective change",

     bug

   };


 }


}

export class TaskClassifier {


 classify(input:string){

   return {
     task: input,
     complexity:
       input.length > 200
       ? "high"
       : "normal"
   };

 }


}

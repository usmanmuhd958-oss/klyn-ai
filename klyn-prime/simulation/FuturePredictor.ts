export class FuturePredictor {


predict(change:string){

 return {

   change,

   impact:
   "analysis_required",

   confidence:0.5

 };

}


}

export class SystemScalePredictor {

 predict(load:number){
   return {
    load,
    scalability:"analyzed"
   };
 }

}

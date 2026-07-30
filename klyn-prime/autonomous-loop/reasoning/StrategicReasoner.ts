export class StrategicReasoner {

 async analyze(context:any, goal:string){

   return {
    objective:goal,
    risks:[],
    strategy:"optimize"
   };

 }

}

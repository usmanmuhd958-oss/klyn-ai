export class ActionPlanner {

 async create(strategy:any){

   return {
    steps:[
      "analyze",
      "execute",
      "verify"
    ]
   };

 }

}

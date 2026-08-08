export class DependencyChecker {

 async verify(){

   return {
     node:true,
     filesystem:true,
     timestamp:Date.now()
   };

 }

}

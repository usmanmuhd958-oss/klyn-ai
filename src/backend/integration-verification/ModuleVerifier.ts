export class ModuleVerifier {


 verify(module:any){

   return {

     module,

     loaded:true,

     status:"verified"

   };

 }


}

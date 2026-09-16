export class UsageMeter {

 record(service:string){
   return {
    service,
    usage:"tracked"
   };
 }

}

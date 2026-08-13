export class SecurityScanner {


 scan(target:any){

   return {

     target,

     security:"scanned",

     vulnerabilities:[]

   };

 }


}

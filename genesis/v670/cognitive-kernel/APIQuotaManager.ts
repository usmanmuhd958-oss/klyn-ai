export class APIQuotaManager {

 check(org:string){
   return {
    organization:org,
    quota:"managed"
   };
 }

}

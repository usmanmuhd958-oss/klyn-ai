export class ResourceQuotaManager {


  allocate(tenant:string){

    return {

      tenant,

      quota:"managed"

    };

  }


}

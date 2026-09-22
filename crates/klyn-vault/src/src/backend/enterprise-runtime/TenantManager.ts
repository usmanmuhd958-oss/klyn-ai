export class TenantManager {

  private tenants = new Map<string, any>();


  register(id:string, tenant:any){

    this.tenants.set(id, tenant);

  }


  get(id:string){

    return this.tenants.get(id);

  }

}

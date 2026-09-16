export class TenantController {

  private tenants:string[]=[];

  createTenant(name:string){
    this.tenants.push(name);
  }

  getTenants(){
    return this.tenants;
  }

}

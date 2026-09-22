export class OrganizationManager {

  private organizations = new Map<string, any>();


  create(id:string, data:any){

    this.organizations.set(id, data);

    return data;

  }


  get(id:string){

    return this.organizations.get(id);

  }

}

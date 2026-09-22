import {TenantManager} from "./TenantManager.js";
import {OrganizationManager} from "./OrganizationManager.js";
import {WorkspaceIsolation} from "./WorkspaceIsolation.js";
import {ResourceQuotaManager} from "./ResourceQuotaManager.js";


export class EnterpriseController {

  tenants = new TenantManager();

  organizations = new OrganizationManager();

  isolation = new WorkspaceIsolation();

  quotas = new ResourceQuotaManager();


  provision(data:any){

    this.organizations.create(
      data.organizationId,
      data
    );

    this.tenants.register(
      data.tenantId,
      data
    );


    return this.quotas.allocate(
      data.tenantId
    );

  }

}

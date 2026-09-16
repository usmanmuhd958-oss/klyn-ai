import {DataSourceRegistry} from "./DataSourceRegistry";

export class EnterpriseDataPlane {

 private registry=new DataSourceRegistry();

 status(){

  return {
   plane:"enterprise-data",
   sources:"online",
   memory:"active",
   rag:"ready"
  };

 }

}

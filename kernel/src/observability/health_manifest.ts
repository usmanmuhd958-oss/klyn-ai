'use strict';class Manifest{
  [key: string]: any;constructor(){this.components={}}register(name,opts){this.components[name]={status:'HEALTHY',...opts}}setDegraded(n,m){if(this.components[n])this.components[n].status='DEGRADED'}setHealthy(n,m){if(this.components[n])this.components[n].status='HEALTHY'}snapshot(){return{components:{...this.components}}}}
let instance;function getManifest(){if(!instance)instance=new Manifest();return instance}
module.exports={getManifest}


export {};

export class Vault{
  [key: string]: any;constructor(){this.locked=false}lock(){this.locked=true}unlock(k){if(k==="KLYN")this.locked=false}}

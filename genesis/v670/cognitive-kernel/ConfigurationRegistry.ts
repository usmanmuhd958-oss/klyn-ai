export class ConfigurationRegistry {

  private config:any = {};

  set(key:string,value:any){
    this.config[key]=value;
  }

  get(key:string){
    return this.config[key];
  }

}

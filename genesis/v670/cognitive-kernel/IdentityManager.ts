import {ServiceIdentity} from "./ServiceIdentity";

export class IdentityManager {

  private identities:ServiceIdentity[]=[];

  register(identity:ServiceIdentity){
    this.identities.push(identity);
  }

  list(){
    return this.identities;
  }

}

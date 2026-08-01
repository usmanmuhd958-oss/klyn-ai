export interface AgentProfile {

 id:string;

 name:string;

 role:string;

 capabilities:string[];

 reputation:number;

}


export class AgentProfileManager {


 create(profile:AgentProfile){

   return profile;

 }


}

export interface GovernancePolicy {

id:string;

name:string;

scope:string;

enabled:boolean;

}


export interface GovernanceEvent {

id:string;

actor:string;

action:string;

resource:string;

timestamp:number;

}

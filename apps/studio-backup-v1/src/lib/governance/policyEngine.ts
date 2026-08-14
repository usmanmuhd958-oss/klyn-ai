import type {
GovernancePolicy
} from "@/types/governance/governance.types";


const policies:GovernancePolicy[]=[];


export function registerPolicy(
policy:GovernancePolicy
){

policies.push(policy);

}


export function evaluatePolicy(
scope:string
){

return policies.filter(
policy=>policy.scope===scope
);

}


export function getPolicies(){

return policies;

}

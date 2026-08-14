export interface GovernanceRule{

name:string;

enabled:boolean;

}


const rules:GovernanceRule[]=[

{
name:"audit-required",
enabled:true
},

{
name:"deployment-validation",
enabled:true
},

{
name:"permission-check",
enabled:true
}

];


export function getGovernanceRules(){

return rules;

}

export function emitGovernanceEvent(
action:string
){

return {

action,

timestamp:Date.now()

};

}

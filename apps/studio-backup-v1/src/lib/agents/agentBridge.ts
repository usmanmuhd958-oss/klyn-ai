export function installAgent(
agentId:string
){

return {

installed:true,

agentId,

timestamp:Date.now()

};

}

export interface DeploymentCommand{
service:string;
environment:string;
action:
"deploy"|
"rollback"|
"inspect";
}


export function executeDeployment(
command:DeploymentCommand
){

return {
accepted:true,
command,
timestamp:Date.now()
};

}

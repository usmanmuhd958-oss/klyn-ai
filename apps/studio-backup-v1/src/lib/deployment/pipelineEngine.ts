import type {
 DeploymentEvent,
 DeploymentHealth
} from "@/types/deployment.types";

const history:DeploymentEvent[]=[];

export function recordDeployment(event:DeploymentEvent){
 history.push(event);
}

export function getDeploymentHistory(){
 return history;
}


export function calculateHealth(
health:DeploymentHealth
){

const score =
health.uptime -
health.errors -
health.latency;

return Math.max(
0,
Math.min(100,score)
);

}

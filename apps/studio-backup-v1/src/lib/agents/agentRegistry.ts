import type {
MarketplaceAgent
} from "@/types/agents/agent.types";


const agents:MarketplaceAgent[]=[];


export function registerAgent(
agent:MarketplaceAgent
){

agents.push(agent);

}


export function discoverAgents(
capability:string
){

return agents.filter(agent =>
agent.capabilities.includes(capability)
);

}


export function getAgents(){

return agents;

}

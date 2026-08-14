import type {
 OSCapability,
 EngineeringDecision
} from "@/types/autonomous-os.types";


const capabilities:OSCapability[]=[
{
id:"editor",
module:"editor",
status:"online",
description:"AI autonomous editor"
},
{
id:"agents",
module:"agents",
status:"online",
description:"Agent swarm runtime"
},
{
id:"planning",
module:"planning",
status:"online",
description:"Autonomous planning"
},
{
id:"workflow",
module:"workflow",
status:"online",
description:"Workflow execution"
},
{
id:"testing",
module:"testing",
status:"online",
description:"Quality intelligence"
},
{
id:"learning",
module:"learning",
status:"online",
description:"Continuous learning"
},
{
id:"deployment",
module:"deployment",
status:"online",
description:"Deployment intelligence"
}
];


const decisions:EngineeringDecision[]=[];


export function getCapabilities(){
 return capabilities;
}


export function recordDecision(
decision:EngineeringDecision
){
 decisions.push(decision);
}


export function getDecisions(){
 return decisions;
}

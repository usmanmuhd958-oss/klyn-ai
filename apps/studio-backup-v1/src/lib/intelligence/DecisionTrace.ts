
export interface DecisionTrace {

id:string;

agentId:string;

intent:string;

action:string;

reasoning:string[];

confidence:number;

risk:number;

timestamp:number;

}


export function createTrace(
data:Omit<DecisionTrace,"timestamp">
):DecisionTrace{

return {

...data,

timestamp:Date.now()

};

}


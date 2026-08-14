export interface RollbackDecision{
required:boolean;
reason:string;
}


export function evaluateRollback(
errorRate:number,
health:number
):RollbackDecision{


if(errorRate>10 || health<50){

return {
required:true,
reason:
"Deployment instability detected"
};

}


return {
required:false,
reason:
"Deployment healthy"
};

}

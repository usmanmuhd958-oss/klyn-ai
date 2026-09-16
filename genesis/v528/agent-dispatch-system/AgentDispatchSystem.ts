export class AgentDispatchSystem {

 dispatch(agent:string,task:string){

  return {
   agent,
   task,
   dispatched:true
  };

 }

}

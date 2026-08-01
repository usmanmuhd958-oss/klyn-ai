export class AgentMissionPlanner {

    createMission(agent:string, task:string){

        return {
            agent,
            task,
            status:"assigned"
        };
    }
}

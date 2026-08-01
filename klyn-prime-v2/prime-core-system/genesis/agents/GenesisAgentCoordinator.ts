import {SpecializedAgentSelector}
from "./SpecializedAgentSelector";

import {AgentMissionPlanner}
from "./AgentMissionPlanner";


export class GenesisAgentCoordinator {

    private selector =
        new SpecializedAgentSelector();

    private planner =
        new AgentMissionPlanner();


    coordinate(goal:string){

        const agents =
            this.selector.select(goal);


        return agents.map(agent =>
            this.planner.createMission(
                agent,
                goal
            )
        );
    }
}

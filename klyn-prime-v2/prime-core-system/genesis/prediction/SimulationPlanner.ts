export class SimulationPlanner {

    createScenario(goal:string){

        return {
            scenario:goal,
            simulations:[
                "performance",
                "security",
                "scalability"
            ]
        };
    }
}

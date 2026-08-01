
export class IntelligenceCoordinator {


    coordinate(agents:any[]){

        return agents.map(agent=>({

            agent,
            task:"assigned"

        }));

    }

}


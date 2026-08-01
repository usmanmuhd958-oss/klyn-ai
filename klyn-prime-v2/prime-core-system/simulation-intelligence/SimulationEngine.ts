export interface SimulationResult {

    scenario:any;

    outcome:any;

    confidence:number;

}


export class SimulationEngine {


    simulate(
        scenario:any
    ):SimulationResult {


        return {

            scenario,

            outcome:null,

            confidence:0

        };

    }


}

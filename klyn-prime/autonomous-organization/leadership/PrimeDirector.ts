export interface Mission {

    goal:string;

    priority:number;

}


export class PrimeDirector {


    async analyzeMission(
        mission:Mission
    ){

        return {

            mission,

            strategy:
            "decompose into specialized tasks"

        };

    }

}

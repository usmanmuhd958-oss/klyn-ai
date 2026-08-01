export interface Mission {

    id:string;

    objective:string;

    priority:number;

    status:
    "created" |
    "running" |
    "completed";

}


export class MissionEngine {


    private missions:Mission[] = [];


    create(
        objective:string,
        priority:number
    ){

        const mission:Mission = {

            id:`mission-${Date.now()}`,

            objective,

            priority,

            status:"created"

        };


        this.missions.push(mission);


        return mission;

    }


    activate(id:string){

        const mission =
        this.missions.find(
            m => m.id === id
        );


        if(mission){

            mission.status="running";

        }


        return mission;

    }


    list(){

        return this.missions;

    }

}

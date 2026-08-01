export interface AgentTeam {

    name:string;

    members:string[];

    purpose:string;

}


export class AgentTeamBuilder {


    createTeam(
        purpose:string,
        agents:string[]
    ):AgentTeam {


        return {

            name:
            "prime-team-" + Date.now(),

            members:
            agents,

            purpose

        };

    }


    optimize(
        team:AgentTeam
    ){

        return {

            team,

            status:
            "optimized"

        };

    }

}

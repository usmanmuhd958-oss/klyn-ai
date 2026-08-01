export interface AgentSkill {

    name:string;

    level:number;

}


export class AgentSpecialization {


    private skills =
    new Map<string,AgentSkill[]>();


    register(
        agent:string,
        skill:AgentSkill
    ){

        const current =
        this.skills.get(agent) || [];


        current.push(skill);


        this.skills.set(
            agent,
            current
        );

    }


    getSkills(
        agent:string
    ){

        return (
            this.skills.get(agent)
            || []
        );

    }


    match(
        requirement:string
    ){

        for(
            const [agent,skills]
            of this.skills
        ){

            if(
                skills.some(
                    s=>s.name===requirement
                )
            ){

                return agent;

            }

        }


        return null;

    }

}

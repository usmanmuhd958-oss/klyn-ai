export class SpecializedAgentSelector {

    select(goal:string){

        const agents = [];

        if(goal.includes("security"))
            agents.push("SecurityAgent");

        if(goal.includes("architecture"))
            agents.push("ArchitectureAgent");

        agents.push(
            "ResearchAgent",
            "CodingAgent",
            "TestingAgent"
        );

        return agents;
    }
}

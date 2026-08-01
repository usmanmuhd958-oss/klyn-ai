export class AgentCouncil {

    members:string[]=[
        "architect",
        "security",
        "research",
        "quality"
    ];

    evaluate(){

        return {
            members:this.members,
            consensus:true
        };
    }
}

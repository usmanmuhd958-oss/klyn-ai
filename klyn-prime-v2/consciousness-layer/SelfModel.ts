export class SelfModel {

    private capabilities: string[];
    private goals: string[];
    private state: string;

    constructor(){
        this.capabilities = [];
        this.goals = [];
        this.state = "initializing";
    }

    registerCapability(capability:string){
        this.capabilities.push(capability);
    }

    setGoal(goal:string){
        this.goals.push(goal);
    }

    updateState(state:string){
        this.state = state;
    }

    describe(){
        return {
            capabilities:this.capabilities,
            goals:this.goals,
            state:this.state
        };
    }
}

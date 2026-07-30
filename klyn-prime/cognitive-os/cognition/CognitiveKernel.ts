export interface CognitiveState {
    goal:string;
    context:any;
    knowledge:any[];
    confidence:number;
}


export class CognitiveKernel {

    private state:CognitiveState;


    constructor(){

        this.state={
            goal:"",
            context:{},
            knowledge:[],
            confidence:0
        };

    }


    initialize(goal:string){

        this.state.goal=goal;

        console.log(
            "[COGNITIVE KERNEL] Goal initialized:",
            goal
        );

    }


    updateContext(context:any){

        this.state.context=context;

    }


    learn(data:any){

        this.state.knowledge.push(data);

        this.state.confidence+=0.01;

    }


    getState(){

        return this.state;

    }


}

export interface IntelligenceState {

    context:any;

    reasoning:any;

    memory:any;

    timestamp:number;

}


export class IntelligenceStateManager {


    private state: IntelligenceState = {

        context:null,

        reasoning:null,

        memory:null,

        timestamp:Date.now()

    };


    update(data:Partial<IntelligenceState>){

        this.state = {

            ...this.state,

            ...data,

            timestamp:Date.now()

        };

    }


    get(){

        return this.state;

    }


}

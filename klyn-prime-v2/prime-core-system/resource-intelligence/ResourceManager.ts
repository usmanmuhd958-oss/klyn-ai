export interface ResourceState {

    cpu:number;

    memory:number;

    activeAgents:number;

    timestamp:number;

}


export class ResourceManager {


    private state:ResourceState = {

        cpu:0,

        memory:0,

        activeAgents:0,

        timestamp:Date.now()

    };


    update(
        data:Partial<ResourceState>
    ){

        this.state = {

            ...this.state,

            ...data,

            timestamp:
            Date.now()

        };

    }


    getState(){

        return this.state;

    }


    optimize(){

        return {

            recommendation:
            "Resource allocation analyzed",

            state:this.state

        };

    }

}

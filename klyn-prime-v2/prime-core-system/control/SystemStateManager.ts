export interface SystemState {

    name:string;

    status:string;

    metrics?:Record<string, any>;

}


export class SystemStateManager {


    private states =
        new Map<string, SystemState>();


    update(state:SystemState){

        this.states.set(
            state.name,
            state
        );

    }


    get(name:string){

        return this.states.get(name);

    }


    snapshot(){

        return [
            ...this.states.values()
        ];

    }

}

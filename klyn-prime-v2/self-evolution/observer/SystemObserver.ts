export interface SystemState {

    modules:number;

    health:string;

}


export class SystemObserver {


    observe():SystemState {

        return {

            modules:0,

            health:"unknown"

        };

    }


}

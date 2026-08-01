export interface Observation {

    source:string;

    data:any;

    timestamp:number;

}


export class SystemObserver {


    observe(
        source:string,
        data:any
    ):Observation {


        return {

            source,

            data,

            timestamp:
            Date.now()

        };

    }


}

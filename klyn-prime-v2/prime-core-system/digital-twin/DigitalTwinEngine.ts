export interface TwinState {

    id:string;

    system:any;

    createdAt:number;

}


export class DigitalTwinEngine {


    private twins =
    new Map<string,TwinState>();


    create(
        id:string,
        system:any
    ){

        const twin:TwinState = {

            id,

            system:

            JSON.parse(
                JSON.stringify(system)
            ),

            createdAt:
            Date.now()

        };


        this.twins.set(
            id,
            twin
        );


        return twin;

    }


    simulate(
        id:string,
        change:any
    ){

        const twin =
        this.twins.get(id);


        if(!twin){

            throw new Error(
                "Twin not found"
            );

        }


        return {

            predicted:true,

            change,

            timestamp:
            Date.now()

        };

    }


    list(){

        return [
            ...this.twins.values()
        ];

    }

}

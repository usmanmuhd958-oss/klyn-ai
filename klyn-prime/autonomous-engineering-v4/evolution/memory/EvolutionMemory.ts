/**
 * KLYN Prime Evolution Memory
 *
 * Long-term memory for autonomous engineering evolution.
 */


export interface EvolutionRecord {

    id:string;

    target:string;

    action:string;

    result:
        | "success"
        | "failed";

    improvement:number;

    lesson:string;

    timestamp:number;

}



export interface MemoryQuery {

    target?:string;

    result?:
        | "success"
        | "failed";

}





export class EvolutionMemory {


    private records:
        EvolutionRecord[];




    constructor(){

        this.records=[];

    }







    store(
        record:EvolutionRecord
    ){

        this.records.push(
            record
        );

    }







    recall(
        query:MemoryQuery = {}
    )
    :
    EvolutionRecord[] {


        return this.records.filter(
            record => {


                if(
                    query.target &&
                    record.target !== query.target
                ){

                    return false;

                }



                if(
                    query.result &&
                    record.result !== query.result
                ){

                    return false;

                }



                return true;

            }

        );


    }







    learn(
        target:string
    ){


        const history =
            this.recall({
                target
            });



        if(history.length === 0){

            return {

                knowledge:
                "No previous evolution data"

            };

        }



        const successful =
            history.filter(
                item =>
                item.result === "success"
            );



        return {


            target,


            attempts:
            history.length,


            successful:
            successful.length,


            averageImprovement:

            successful.reduce(
                (sum,item)=>
                sum + item.improvement,
                0
            )
            /
            Math.max(
                successful.length,
                1
            ),



            lesson:
            successful
            .map(
                item =>
                item.lesson
            )

        };


    }







    export(){

        return [
            ...this.records
        ];

    }


}

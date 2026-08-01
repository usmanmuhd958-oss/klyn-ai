export interface ReputationScore {

    agent:string;

    success:number;

    failures:number;

    score:number;

}


export class AgentReputation {


    private records =
    new Map<string,ReputationScore>();


    update(
        agent:string,
        success:boolean
    ){

        let record =
        this.records.get(agent)
        ||
        {
            agent,
            success:0,
            failures:0,
            score:0
        };


        if(success){

            record.success++;

        }
        else{

            record.failures++;

        }


        record.score =
        record.success /
        Math.max(
            1,
            record.success +
            record.failures
        );


        this.records.set(
            agent,
            record
        );


        return record;

    }


    ranking(){

        return [
            ...this.records.values()
        ]
        .sort(
            (a,b)=>
            b.score-a.score
        );

    }

}

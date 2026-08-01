export interface StrategyRecord {

    task:string;

    strategy:string;

    score:number;

    timestamp:number;

}


export class StrategyMemory {


    private strategies:StrategyRecord[] = [];


    remember(
        record:StrategyRecord
    ){

        this.strategies.push(record);

    }


    best(
        task:string
    ){

        return this.strategies
        .filter(
            s=>s.task===task
        )
        .sort(
            (a,b)=>b.score-a.score
        )[0];

    }


    all(){

        return this.strategies;

    }

}

export interface Strategy {

    name:string;

    score:number;

}


export class StrategyOptimizer {


    optimize(strategies:Strategy[]){

        return strategies.sort(
            (a,b)=>b.score-a.score
        )[0];

    }


}

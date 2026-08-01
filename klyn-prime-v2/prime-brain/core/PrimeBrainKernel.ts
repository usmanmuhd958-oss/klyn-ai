export interface BrainGoal {

    id:string;

    objective:string;

    priority:number;

}


export class PrimeBrainKernel {


    private goals:BrainGoal[] = [];


    receiveGoal(goal:BrainGoal){

        this.goals.push(goal);

    }


    getGoals(){

        return this.goals;

    }


    decide(){

        return {

            action:"analyze",

            reason:"Goal requires intelligence processing"

        };

    }


}

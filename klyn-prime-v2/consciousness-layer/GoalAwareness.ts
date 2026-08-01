export class GoalAwareness {

    private objectives:string[] = [];

    addObjective(goal:string){
        this.objectives.push(goal);
    }

    evaluate(){
        return {
            activeGoals:this.objectives,
            count:this.objectives.length
        };
    }
}

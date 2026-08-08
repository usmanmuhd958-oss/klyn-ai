export class GoalHierarchyEngine {

  goals:any[]=[];

  add(goal:any, priority:number){
    this.goals.push({
      goal,
      priority
    });
  }

  rank(){
    return this.goals.sort(
      (a,b)=>b.priority-a.priority
    );
  }
}

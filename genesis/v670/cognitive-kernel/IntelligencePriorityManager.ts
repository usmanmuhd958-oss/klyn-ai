export class IntelligencePriorityManager {

  prioritize(tasks:any[]){
    return {
      status:"priority_assigned",
      tasks
    };
  }

}

export class ImprovementTracker {
  record(change:string){
    return {
      improvement: change,
      time: Date.now()
    };
  }
}

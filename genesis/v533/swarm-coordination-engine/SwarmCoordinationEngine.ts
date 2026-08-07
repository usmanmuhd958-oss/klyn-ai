export class SwarmCoordinationEngine {
  dispatch(task:any){
    return {
      task,
      distributed:true
    }
  }
}

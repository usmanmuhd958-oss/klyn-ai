export class EventStreamEngine {
  publish(event:any){
    return {
      event,
      published:true
    };
  }
}

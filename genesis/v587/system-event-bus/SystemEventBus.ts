type EventHandler = (data:any)=>void;

export class SystemEventBus {

  private events: Record<string, EventHandler[]> = {};

  subscribe(event:string, handler:EventHandler){
    if(!this.events[event]){
      this.events[event]=[];
    }

    this.events[event].push(handler);
  }


  publish(event:string,data:any){

    for(const handler of this.events[event] || []){
      handler(data);
    }

  }

}

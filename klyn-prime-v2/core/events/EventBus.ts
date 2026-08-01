import { KlynEvent } from "../contracts/EventContract";

export class EventBus {

  private listeners:
    Map<string, ((event: KlynEvent)=>void)[]> = new Map();


  subscribe(
    type:string,
    handler:(event:KlynEvent)=>void
  ){
    const existing =
      this.listeners.get(type) || [];

    existing.push(handler);

    this.listeners.set(type, existing);
  }


  publish(event:KlynEvent){

    const handlers =
      this.listeners.get(event.type) || [];

    for(const handler of handlers){
      handler(event);
    }

  }

}

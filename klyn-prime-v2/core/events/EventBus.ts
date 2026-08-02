import { KlynEvent } from "../contracts/EventContract";

export class EventBus {

  private listeners:
    Map<string, ((event: KlynEvent)=>void | Promise<void>)[]> = new Map();


  subscribe(
    type:string,
    handler:(event:KlynEvent)=>void | Promise<void>
  ){
    const existing =
      this.listeners.get(type) || [];

    existing.push(handler);

    this.listeners.set(type, existing);
  }


  async publish(event:KlynEvent): Promise<void> {

    const handlers =
      this.listeners.get(event.type) || [];

    const results: Promise<void>[] = [];

    for(const handler of handlers){
      try{
        const result = handler(event);
        if (result && typeof result.catch === "function") {
          results.push(
            result.catch((error: Error) => {
              console.error(`[EventBus] Handler failed for event ${event.type}:`, error);
            })
          );
        }
      }catch(error){
        console.error(`[EventBus] Sync handler failed for event ${event.type}:`, error);
      }
    }

    if (results.length > 0) {
      await Promise.allSettled(results);
    }

  }

}

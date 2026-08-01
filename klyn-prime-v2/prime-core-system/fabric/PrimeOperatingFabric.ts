export interface PrimeEvent {

    type:string;

    source:string;

    payload:any;

    timestamp:number;

}


export class PrimeOperatingFabric {


    private listeners =
    new Map<string, Function[]>();


    subscribe(
        event:string,
        handler:Function
    ){

        if(!this.listeners.has(event)){

            this.listeners.set(
                event,
                []
            );

        }


        this.listeners
        .get(event)!
        .push(handler);

    }


    publish(
        event:PrimeEvent
    ){

        const handlers =
        this.listeners.get(
            event.type
        ) || [];


        for(const handler of handlers){

            handler(event);

        }

    }

}

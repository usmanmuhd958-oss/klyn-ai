export interface PrimeEvent {

    type:string;

    payload:any;

    timestamp:number;

}


export class PrimeEventBus {


    private listeners =
        new Map<string, Function[]>();


    subscribe(
        type:string,
        handler:Function
    ){

        if(!this.listeners.has(type)){

            this.listeners.set(
                type,
                []
            );

        }


        this.listeners
        .get(type)!
        .push(handler);

    }



    publish(
        event:PrimeEvent
    ){

        const handlers =
        this.listeners.get(event.type)
        || [];


        for(const handler of handlers){

            handler(event);

        }

    }


}

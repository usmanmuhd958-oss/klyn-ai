export class IntelligenceMessageBus {


    private messages:any[] = [];


    publish(message:any){

        this.messages.push(message);

    }


    consume(){

        return this.messages.shift();

    }


}

export interface IntelligenceMessage {

    source:string;

    target:string;

    payload:any;

}


export class IntelligenceMesh {


    private modules = new Map<string, any>();


    register(name:string, module:any){

        this.modules.set(name,module);

    }


    send(message:IntelligenceMessage){

        const target = this.modules.get(message.target);

        if(target){

            return target.receive(message.payload);

        }

        return null;

    }


}

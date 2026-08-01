export interface SystemCapability {

    name:string;

    status:string;

}


export class SystemSelfModel {


    private capabilities:
    SystemCapability[] = [];


    registerCapability(
        capability:SystemCapability
    ){

        this.capabilities.push(
            capability
        );

    }


    describe(){

        return {

            identity:
            "KLYN PRIME",

            capabilities:
            this.capabilities,

            timestamp:
            Date.now()

        };

    }


}

/**
 * KLYN Prime AI OS Core v1
 *
 * Central intelligence coordination kernel.
 */


export type SystemModule =
    | "planner"
    | "agents"
    | "memory"
    | "knowledge"
    | "security"
    | "governance"
    | "workflow"
    | "digital-twin";



export interface ModuleRegistration {

    id:string;

    name:string;

    type:SystemModule;

    status:
        | "online"
        | "offline";

    version:string;

}



export interface KernelEvent {

    id:string;

    source:string;

    event:string;

    payload:unknown;

    timestamp:number;

}







export class KlynKernel {


    private modules:
        ModuleRegistration[];


    private events:
        KernelEvent[];




    constructor(){

        this.modules=[];

        this.events=[];


        console.log(
            "[KLYN PRIME AI OS CORE v1] BOOTING"
        );

    }







    registerModule(
        module:ModuleRegistration
    ){

        this.modules.push(
            module
        );


        return module;

    }







    dispatch(
        event:KernelEvent
    ){

        this.events.push(
            event
        );


        return {

            accepted:true,

            routedTo:
            this.modules
            .filter(

                item =>
                item.status === "online"

            )
            .map(

                item =>
                item.name

            )

        };

    }







    systemHealth(){

        return {

            modules:
            this.modules.length,


            online:
            this.modules.filter(

                item =>
                item.status === "online"

            ).length,


            events:
            this.events.length,


            timestamp:
            Date.now()

        };

    }







    snapshot(){

        return {

            modules:
            this.modules,


            events:
            this.events,


            generatedAt:
            Date.now()

        };

    }



}

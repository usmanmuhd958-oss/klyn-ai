/**
 * KLYN Prime Intelligence Marketplace v1
 *
 * Capability discovery and extension registry.
 */


export type CapabilityType =
    | "agent"
    | "plugin"
    | "model"
    | "workflow";



export interface Capability {

    id:string;

    name:string;

    type:CapabilityType;

    version:string;

    description:string;

    provider:string;

    enabled:boolean;

}



export interface CompatibilityResult {

    capabilityId:string;

    compatible:boolean;

    reason:string;

}







export class CapabilityRegistry {


    private capabilities:
        Capability[];




    constructor(){

        this.capabilities=[];


        console.log(
            "[KLYN INTELLIGENCE MARKETPLACE v1] Online"
        );

    }







    register(
        capability:Capability
    ){

        this.capabilities.push(
            capability
        );


        return capability;

    }







    discover(
        type:CapabilityType
    ){

        return this.capabilities.filter(

            item =>

            item.type === type
            &&
            item.enabled

        );

    }







    checkCompatibility(
        capabilityId:string
    ):CompatibilityResult{


        const capability =
            this.capabilities.find(

                item =>
                item.id === capabilityId

            );



        return {

            capabilityId,


            compatible:
            !!capability,


            reason:
            capability
            ?
            "Capability available"
            :
            "Capability not found"

        };

    }







    marketplaceState(){

        return {

            total:
            this.capabilities.length,


            active:
            this.capabilities.filter(

                item =>
                item.enabled

            ).length,


            capabilities:
            this.capabilities,


            timestamp:
            Date.now()

        };

    }



}

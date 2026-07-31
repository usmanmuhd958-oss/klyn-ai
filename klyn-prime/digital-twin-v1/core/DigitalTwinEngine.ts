/**
 * KLYN Prime Digital Twin Engineering Model v1
 *
 * Software system simulation foundation.
 */


export type ComponentType =
    | "service"
    | "module"
    | "database"
    | "agent"
    | "workflow";



export interface SystemComponent {

    id:string;

    name:string;

    type:ComponentType;

    version:string;

    health:number;

    metadata:Record<string,unknown>;

}



export interface DependencyLink {

    source:string;

    target:string;

    relation:string;

}



export interface SimulationResult {

    component:string;

    risk:number;

    impact:string;

    confidence:number;

}







export class DigitalTwinEngine {


    private components:
        SystemComponent[];


    private dependencies:
        DependencyLink[];




    constructor(){

        this.components=[];

        this.dependencies=[];


        console.log(
            "[KLYN DIGITAL TWIN ENGINE v1] Online"
        );

    }







    registerComponent(
        component:SystemComponent
    ){

        this.components.push(
            component
        );


        return component;

    }







    connectComponents(
        link:DependencyLink
    ){

        this.dependencies.push(
            link
        );


        return link;

    }







    findImpact(
        componentId:string
    ){

        return this.dependencies.filter(

            item =>
            item.source === componentId
            ||
            item.target === componentId

        );

    }







    simulateChange(
        componentId:string,
        change:string
    ):SimulationResult{


        const affected =
            this.findImpact(
                componentId
            );



        const risk =
            Math.min(
                affected.length / 10,
                1
            );



        return {


            component:
            componentId,


            risk,


            impact:
            change,


            confidence:
            1 - risk


        };

    }







    snapshot(){

        return {

            components:
            this.components,


            dependencies:
            this.dependencies,


            createdAt:
            Date.now()

        };

    }



}

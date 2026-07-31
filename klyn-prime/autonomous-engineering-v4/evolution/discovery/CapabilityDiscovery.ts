/**
 * KLYN Prime Capability Discovery Engine
 *
 * Discovers existing abilities,
 * identifies missing capabilities,
 * and generates evolution opportunities.
 */


export interface Capability {

    id:string;

    name:string;

    description:string;

    level:number;

    category:
        | "reasoning"
        | "coding"
        | "security"
        | "research"
        | "automation";

}



export interface CapabilityGap {

    capability:string;

    currentLevel:number;

    requiredLevel:number;

    priority:
        | "low"
        | "medium"
        | "high";

    recommendation:string;

}



export class CapabilityDiscovery {


    private capabilities:
        Capability[];



    constructor(){

        this.capabilities=[];

    }






    register(
        capability:Capability
    ){

        this.capabilities.push(
            capability
        );

    }







    discover(){

        return {

            total:
            this.capabilities.length,


            capabilities:
            this.capabilities

        };

    }







    analyzeGap(
        required:
        Capability[]
    )
    :
    CapabilityGap[] {


        return required

        .filter(
            requirement => {

                const existing =
                    this.capabilities.find(
                        item =>
                        item.name === requirement.name
                    );


                return !existing ||
                       existing.level <
                       requirement.level;

            }
        )

        .map(
            item => {


                const existing =
                    this.capabilities.find(
                        c =>
                        c.name === item.name
                    );


                return {


                    capability:
                    item.name,


                    currentLevel:
                    existing?.level ?? 0,


                    requiredLevel:
                    item.level,


                    priority:
                    item.level > 80
                    ?
                    "high"
                    :
                    "medium",


                    recommendation:
                    `Upgrade ${item.name} capability`

                };


            }

        );


    }







    roadmap(){

        return this.capabilities.map(

            capability => ({

                capability:
                capability.name,


                nextLevel:
                capability.level + 10


            })

        );

    }



}

/**
 * KLYN Prime Autonomous Engineering v4
 *
 * Software World Model Engine
 *
 * Builds an internal representation
 * of the entire software ecosystem.
 */


export type EntityType =
    | "project"
    | "module"
    | "file"
    | "service"
    | "dependency"
    | "agent";



export interface WorldEntity {

    id:string;

    name:string;

    type:EntityType;

    metadata:Record<string, unknown>;

}




export interface Relationship {

    from:string;

    to:string;

    relation:
        | "contains"
        | "depends-on"
        | "communicates-with"
        | "executes";

}





export interface ArchitectureSnapshot {

    entities:WorldEntity[];

    relationships:Relationship[];

    createdAt:number;

}





export class SoftwareWorldModel {


    private entities:
        Map<string,WorldEntity>;


    private relationships:
        Relationship[];




    constructor(){

        this.entities =
            new Map();


        this.relationships=[];

    }






    registerEntity(
        entity:WorldEntity
    ){


        this.entities.set(
            entity.id,
            entity
        );


    }







    connect(
        relationship:Relationship
    ){


        this.relationships.push(
            relationship
        );


    }







    findEntity(
        id:string
    ){


        return this.entities.get(id);


    }







    analyzeArchitecture()
    :
    ArchitectureSnapshot {



        return {


            entities:
            Array.from(
                this.entities.values()
            ),


            relationships:
            this.relationships,


            createdAt:
            Date.now()


        };


    }







    getDependencies(
        entityId:string
    ){


        return this.relationships.filter(

            r =>
            r.from === entityId &&
            r.relation === "depends-on"

        );


    }






    getCommunicationMap(){

        return this.relationships.filter(

            r =>
            r.relation ===
            "communicates-with"

        );

    }



}

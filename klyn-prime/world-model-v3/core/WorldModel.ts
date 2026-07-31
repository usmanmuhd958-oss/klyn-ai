/**
 * KLYN Prime World Model v3
 *
 * Internal representation of software reality.
 */


export type EntityType =
    | "file"
    | "module"
    | "service"
    | "agent"
    | "database"
    | "dependency";



export interface WorldEntity {

    id:string;

    name:string;

    type:EntityType;

    metadata:Record<string,unknown>;

}



export interface Relationship {

    from:string;

    to:string;

    relation:
        | "depends_on"
        | "contains"
        | "communicates_with"
        | "extends";

}






export class WorldModel {


    private entities:
        WorldEntity[];


    private relationships:
        Relationship[];




    constructor(){

        this.entities=[];

        this.relationships=[];


        console.log(
            "[KLYN WORLD MODEL v3] Online"
        );

    }







    registerEntity(
        entity:WorldEntity
    ){

        this.entities.push(
            entity
        );

        return entity;

    }







    connect(
        relationship:Relationship
    ){

        this.relationships.push(
            relationship
        );

    }







    findEntity(
        name:string
    ){

        return this.entities.filter(
            entity =>
            entity.name
            .includes(name)
        );

    }







    getDependencies(
        id:string
    ){

        return this.relationships.filter(
            relation =>

            relation.from === id
            &&
            relation.relation === "depends_on"

        );

    }







    impactAnalysis(
        entityId:string
    ){

        return this.relationships.filter(
            relation =>
            relation.from === entityId
            ||
            relation.to === entityId
        );

    }







    snapshot(){

        return {

            entities:
            this.entities,


            relationships:
            this.relationships,


            timestamp:
            Date.now()

        };

    }



}

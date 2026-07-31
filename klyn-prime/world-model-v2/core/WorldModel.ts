/**
 * KLYN Prime World Model v2
 *
 * Software understanding and prediction foundation.
 */


export type EntityType =
    | "service"
    | "module"
    | "agent"
    | "database"
    | "workflow"
    | "dependency";



export interface WorldEntity {

    id:string;

    name:string;

    type:EntityType;

    properties:Record<string,unknown>;

    createdAt:number;

}



export interface Relationship {

    source:string;

    target:string;

    relation:
        | "depends_on"
        | "communicates_with"
        | "contains"
        | "produces";

}







export interface Prediction {

    id:string;

    target:string;

    outcome:string;

    confidence:number;

    timestamp:number;

}







export class WorldModel {


    private entities:
        WorldEntity[];


    private relationships:
        Relationship[];


    private predictions:
        Prediction[];




    constructor(){

        this.entities=[];

        this.relationships=[];

        this.predictions=[];


        console.log(
            "[KLYN WORLD MODEL v2] Online"
        );

    }







    observeEntity(
        entity:WorldEntity
    ){

        this.entities.push(
            entity
        );


        return entity;

    }







    createRelationship(
        relationship:Relationship
    ){

        this.relationships.push(
            relationship
        );


        return relationship;

    }







    findDependencies(
        entityId:string
    ){

        return this.relationships.filter(

            item =>
            item.source === entityId
            &&
            item.relation === "depends_on"

        );

    }







    predict(
        target:string,
        outcome:string,
        confidence:number
    ){


        const prediction:Prediction = {


            id:
            crypto.randomUUID(),


            target,


            outcome,


            confidence,


            timestamp:
            Date.now()


        };


        this.predictions.push(
            prediction
        );


        return prediction;

    }







    analyze(){

        return {

            entities:
            this.entities.length,


            relationships:
            this.relationships.length,


            predictions:
            this.predictions.length

        };

    }







    snapshot(){

        return {

            entities:
            this.entities,


            relationships:
            this.relationships,


            predictions:
            this.predictions

        };

    }



}

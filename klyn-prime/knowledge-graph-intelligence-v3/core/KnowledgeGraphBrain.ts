/**
 * KLYN Prime Autonomous Knowledge Graph Intelligence v3
 *
 * Semantic relationship intelligence foundation.
 */


export type EntityType =
    | "code"
    | "agent"
    | "service"
    | "database"
    | "workflow"
    | "concept";



export type RelationType =
    | "depends-on"
    | "uses"
    | "contains"
    | "produces"
    | "related-to";



export interface KnowledgeEntity {

    id:string;

    name:string;

    type:EntityType;

    metadata:Record<string,unknown>;

}



export interface KnowledgeRelation {

    id:string;

    sourceId:string;

    targetId:string;

    type:RelationType;

    confidence:number;

}







export class KnowledgeGraphBrain {


    private entities:
        KnowledgeEntity[];


    private relations:
        KnowledgeRelation[];




    constructor(){

        this.entities=[];

        this.relations=[];


        console.log(
            "[KLYN KNOWLEDGE GRAPH INTELLIGENCE v3] Online"
        );

    }







    addEntity(
        entity:KnowledgeEntity
    ){

        this.entities.push(
            entity
        );


        return entity;

    }







    addRelation(
        relation:KnowledgeRelation
    ){

        this.relations.push(
            relation
        );


        return relation;

    }







    findConnections(
        entityId:string
    ){

        return this.relations.filter(

            relation =>

            relation.sourceId === entityId
            ||
            relation.targetId === entityId

        );

    }







    understand(
        entityId:string
    ){

        const entity =
            this.entities.find(

                item =>
                item.id === entityId

            );


        const connections =
            this.findConnections(
                entityId
            );



        return {

            entity,

            connections,

            relationshipCount:
            connections.length

        };

    }







    graphState(){

        return {

            entities:
            this.entities,


            relations:
            this.relations,


            timestamp:
            Date.now()

        };

    }



}

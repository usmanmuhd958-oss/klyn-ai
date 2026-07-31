/**
 * KLYN Prime World Model v2
 *
 * Global software intelligence representation layer.
 */


export interface Entity {

    id:string;

    name:string;

    type:
        | "service"
        | "module"
        | "agent"
        | "database"
        | "workflow";

    metadata:Record<string,unknown>;

}



export interface Relationship {

    from:string;

    to:string;

    relation:
        | "depends_on"
        | "communicates_with"
        | "controls"
        | "stores";

    strength:number;

}





export class WorldModel {


    private entities:
        Map<string,Entity>;


    private relationships:
        Relationship[];




    constructor(){

        this.entities =
            new Map();

        this.relationships =
            [];

    }







    registerEntity(
        entity:Entity
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







    understand(
        id:string
    ){

        const entity =
            this.entities.get(id);


        if(!entity){

            return null;

        }



        const connections =
            this.relationships.filter(
                r =>
                r.from === id ||
                r.to === id
            );



        return {

            entity,

            connections,

            intelligence:
            this.calculateImportance(
                id
            )

        };

    }







    private calculateImportance(
        id:string
    ){

        const count =
            this.relationships.filter(
                r =>
                r.from === id ||
                r.to === id
            ).length;



        return {

            influence:
            count,


            score:
            Math.min(
                count * 10,
                100
            )

        };

    }







    snapshot(){

        return {

            entities:
            Array.from(
                this.entities.values()
            ),


            relationships:
            this.relationships

        };

    }


}

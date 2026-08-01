export interface SystemEntity {

    id:string;

    type:string;

    state:any;

}


export class WorldModelCore {


    private entities:SystemEntity[] = [];


    register(entity:SystemEntity){

        this.entities.push(entity);

    }


    getEntities(){

        return this.entities;

    }


    understand(){

        return {

            entities:this.entities.length,

            status:"world model active"

        };

    }


}

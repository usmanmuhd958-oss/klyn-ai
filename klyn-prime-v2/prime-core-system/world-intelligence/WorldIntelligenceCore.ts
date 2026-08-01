export interface WorldState {

    entities:any[];

    relationships:any[];

    predictions:any[];

}


export class WorldIntelligenceCore {


    private world:WorldState = {

        entities:[],

        relationships:[],

        predictions:[]

    };


    update(data:Partial<WorldState>){

        this.world = {

            ...this.world,

            ...data

        };

    }


    understand(){

        return this.world;

    }


}

export interface WorldEntity {

    id:string;

    category:string;

    properties:any;

}


export class WorldModelEngine {


    private entities =
        new Map<string, WorldEntity>();


    register(entity:WorldEntity){

        this.entities.set(
            entity.id,
            entity
        );

    }


    understand(id:string){

        return this.entities.get(id);

    }


    analyze(category:string){

        return [
            ...this.entities.values()
        ]
        .filter(
            entity =>
            entity.category === category
        );

    }


    snapshot(){

        return [
            ...this.entities.values()
        ];

    }

}

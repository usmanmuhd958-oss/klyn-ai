import { MemoryStore } from "../memory/MemoryStore";


export class LearningEngine {


    constructor(
        private memory:MemoryStore
    ){}


    learn(
        experience:any
    ){

        this.memory.save({

            id:
            `exp-${Date.now()}`,

            type:
            "experience",

            data:
            experience,

            timestamp:
            Date.now()

        });


        return {

            learned:true,

            message:
            "Experience stored for future improvement"

        };

    }


    recall(){

        return this.memory.search(
            "experience"
        );

    }

}

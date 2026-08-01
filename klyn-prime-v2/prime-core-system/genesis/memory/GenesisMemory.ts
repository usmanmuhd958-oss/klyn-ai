export class GenesisMemory {

    private experiences:any[] = [];


    store(experience:any){

        this.experiences.push(
            experience
        );

        console.log(
            "[GENESIS MEMORY] Experience stored"
        );
    }


    recall(){

        return this.experiences;
    }
}

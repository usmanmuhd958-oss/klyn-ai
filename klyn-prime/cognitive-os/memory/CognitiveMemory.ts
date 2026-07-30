export class CognitiveMemory {


    private memories:any[]=[];


    store(data:any){

        this.memories.push(data);

    }


    recall(){

        return this.memories;

    }


}

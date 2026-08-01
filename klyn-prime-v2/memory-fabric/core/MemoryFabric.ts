export interface MemoryRecord {

    id:string;

    type:string;

    data:any;

}


export class MemoryFabric {


    private memories:MemoryRecord[] = [];


    store(memory:MemoryRecord){

        this.memories.push(memory);

        return true;

    }


    recall(type:string){

        return this.memories.filter(

            memory => memory.type === type

        );

    }


}

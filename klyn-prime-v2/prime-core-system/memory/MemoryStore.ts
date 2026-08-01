export interface MemoryItem {

    id:string;

    type:string;

    data:any;

    timestamp:number;

}


export class MemoryStore {


    private memories:MemoryItem[] = [];


    save(memory:MemoryItem){

        this.memories.push(
            memory
        );

    }


    search(type:string){

        return this.memories.filter(
            item =>
            item.type === type
        );

    }


    all(){

        return this.memories;

    }

}

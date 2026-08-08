export class BackendMemory {

    memory:any[];

    constructor(){
        this.memory=[];
    }

    store(data:any){
        this.memory.push(data);
    }

    recall(){
        return this.memory;
    }
}

export class StateAwareness {

    private systemState:any = {};

    update(key:string,value:any){
        this.systemState[key]=value;
    }

    snapshot(){
        return this.systemState;
    }
}


export class ContextEngine {


    private context:any = {};


    update(key:string,value:any){

        this.context[key]=value;

    }


    get(){

        return this.context;

    }

}


export class ContextManager {


    private context:any[]=[];


    add(data:any){

        this.context.push(data);

    }


    get(){

        return this.context;

    }


}

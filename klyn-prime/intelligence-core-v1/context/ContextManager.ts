export interface IntelligenceContext {

    goal:string;

    data:any;

    history:any[];

}


export class ContextManager {

    private context:IntelligenceContext = {
        goal:"",
        data:{},
        history:[]
    };


    update(context:IntelligenceContext){

        this.context = context;

    }


    get(){

        return this.context;

    }

}

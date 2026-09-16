
export class ModelRouter {


 select(task:string){

    if(task.includes("code")){
        return "coding-model";
    }


    if(task.includes("security")){
        return "security-model";
    }


    return "general-model";

 }


}


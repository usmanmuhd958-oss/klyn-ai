export class MultiModelRouter {

    route(task:string){

        if(task.includes("architecture")){
            return "reasoning-model";
        }

        if(task.includes("code")){
            return "engineering-model";
        }

        if(task.includes("security")){
            return "security-model";
        }

        return "general-model";
    }
}

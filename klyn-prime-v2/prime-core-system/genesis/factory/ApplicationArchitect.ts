export class ApplicationArchitect {

    design(goal:string){

        return {
            goal,
            components:[
                "frontend",
                "backend",
                "database",
                "services"
            ]
        };
    }
}

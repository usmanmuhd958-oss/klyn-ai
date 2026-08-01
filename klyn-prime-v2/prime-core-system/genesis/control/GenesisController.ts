export class GenesisController {

    execute(goal:string){

        return {
            goal,
            pipeline:[
                "research",
                "design",
                "generate",
                "validate",
                "evolve"
            ],
            status:"running"
        };
    }
}

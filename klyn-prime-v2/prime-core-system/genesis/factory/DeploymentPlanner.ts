export class DeploymentPlanner {

    plan(system:string){

        return {
            system,
            targets:[
                "cloud",
                "container",
                "edge"
            ]
        };
    }
}

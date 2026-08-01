export class DependencyResolver {

    resolve(capability:any){

        return {
            capability,
            dependencies:[
                "kernel",
                "runtime",
                "validation"
            ]
        };
    }
}

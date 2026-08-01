export class SystemArchitect {

    design(capability:any){

        return {
            name:"GeneratedSystem",
            basedOn: capability,
            layers:[
                "core",
                "runtime",
                "integration",
                "validation"
            ]
        };
    }
}

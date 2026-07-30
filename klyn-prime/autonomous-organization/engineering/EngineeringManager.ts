export class EngineeringManager {


    plan(project:string){

        return {

            project,

            phases:[

                "architecture",

                "implementation",

                "testing"

            ]

        };

    }

}

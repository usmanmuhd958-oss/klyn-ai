export class ScenarioGenerator {


    generate(input:any){


        return [

            {
                type:"current",
                input
            },

            {
                type:"alternative",
                input
            }

        ];


    }


}

export class DecisionEngine {


    decide(options:any[]){

        return {

            selected:
            options[0],

            confidence:
            0.5

        };

    }

}

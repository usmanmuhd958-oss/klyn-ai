export class ConsensusEngine {


    evaluate(outputs:string[]){

        return {
            agreement:
            outputs.length,
            confidence:
            Math.min(outputs.length * 20,100)
        };

    }

}

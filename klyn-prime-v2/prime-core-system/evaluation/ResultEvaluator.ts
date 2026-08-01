export interface EvaluationResult {

    success:boolean;

    score:number;

    feedback:string;

}


export class ResultEvaluator {


    evaluate(result:any):EvaluationResult {


        return {

            success:true,

            score:0,

            feedback:
            "evaluation completed"

        };

    }


}

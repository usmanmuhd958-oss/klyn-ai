export class DeepReasoner {


    reason(problem:any){

        return {

            hypothesis:
            `Analyze ${problem}`,

            reasoningSteps:[
                "observe",
                "decompose",
                "evaluate",
                "solve"
            ]

        };

    }


}

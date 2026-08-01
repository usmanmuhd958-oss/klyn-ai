export interface TaskAnalysis {

    task:string;

    complexity:string;

    requiredCapabilities:string[];

}


export class TaskAnalyzer {


    analyze(
        task:string
    ):TaskAnalysis {


        return {

            task,

            complexity:
            "unknown",

            requiredCapabilities:[]

        };


    }


}

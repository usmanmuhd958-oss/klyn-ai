/**
 * KLYN Prime Code Intelligence v2
 *
 * Semantic Analysis Engine
 *
 * Understands code quality, structure,
 * complexity and improvement opportunities.
 */


export interface AnalysisRequest {

    filePath:string;

    language:string;

    source:string;

}



export interface SemanticIssue {

    type:
        | "complexity"
        | "security"
        | "maintainability"
        | "architecture";

    message:string;

    severity:
        | "low"
        | "medium"
        | "high";

}



export interface SemanticReport {

    file:string;

    score:number;

    issues:SemanticIssue[];

    suggestions:string[];

    timestamp:number;

}





export class SemanticAnalyzer {


    private reports:SemanticReport[];




    constructor(){

        this.reports=[];

    }





    analyze(
        request:AnalysisRequest
    ):SemanticReport {


        const issues =
            this.detectIssues(
                request.source
            );



        const report:SemanticReport = {


            file:
                request.filePath,


            score:
                this.calculateScore(
                    issues
                ),


            issues,


            suggestions:[

                "Improve module separation",

                "Reduce unnecessary complexity",

                "Add stronger type safety",

                "Increase automated validation"

            ],


            timestamp:
                Date.now()

        };



        this.reports.push(report);


        return report;

    }






    private detectIssues(
        source:string
    ):SemanticIssue[] {


        const issues:SemanticIssue[]=[];



        const lines =
            source.split("\n").length;



        if(lines > 500){

            issues.push({

                type:
                    "complexity",

                message:
                    "Large file detected. Consider splitting modules.",

                severity:
                    "medium"

            });

        }




        if(
            source.includes("any")
        ){

            issues.push({

                type:
                    "maintainability",

                message:
                    "Weak typing detected.",

                severity:
                    "medium"

            });

        }




        if(
            source.includes("eval(")
        ){

            issues.push({

                type:
                    "security",

                message:
                    "Dynamic code execution detected.",

                severity:
                    "high"

            });

        }




        if(
            source.includes("TODO")
        ){

            issues.push({

                type:
                    "architecture",

                message:
                    "Incomplete implementation marker detected.",

                severity:
                    "low"

            });

        }



        return issues;

    }





    private calculateScore(
        issues:SemanticIssue[]
    ):number {


        let score = 100;



        for(
            const issue of issues
        ){

            if(
                issue.severity === "high"
            ){

                score -= 20;

            }


            if(
                issue.severity === "medium"
            ){

                score -= 10;

            }


            if(
                issue.severity === "low"
            ){

                score -= 5;

            }

        }



        return Math.max(
            score,
            0
        );

    }





    getReports(){

        return this.reports;

    }


}

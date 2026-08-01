export interface VerificationResult {

    passed:boolean;

    score:number;

    issues:string[];

}


export class VerificationEngine {


    verify(output:any):VerificationResult {


        const issues:string[] = [];


        if(!output){

            issues.push(
                "No output produced"
            );

        }


        return {

            passed:
            issues.length === 0,

            score:
            issues.length === 0 ? 100 : 50,

            issues

        };

    }


}

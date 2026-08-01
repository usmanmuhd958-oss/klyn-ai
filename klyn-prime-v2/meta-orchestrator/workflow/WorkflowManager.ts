export class WorkflowManager {


    createWorkflow(steps:string[]){

        return {

            steps,

            state:"created"

        };

    }


}

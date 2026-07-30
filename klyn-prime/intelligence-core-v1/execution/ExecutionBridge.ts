export class ExecutionBridge {


    execute(action:any){

        return {

            action,

            status:
            "queued"

        };

    }

}

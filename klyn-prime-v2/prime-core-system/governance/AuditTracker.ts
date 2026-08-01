export class AuditTracker {


    private logs:any[] = [];


    record(event:any){

        this.logs.push({

            event,

            time:Date.now()

        });

    }


    history(){

        return this.logs;

    }


}

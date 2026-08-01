export interface TrustRecord {

    actor:string;

    action:string;

    allowed:boolean;

    timestamp:number;

}


export class TrustManager {


    private records:TrustRecord[] = [];


    check(
        actor:string,
        action:string
    ){

        const record:TrustRecord = {

            actor,

            action,

            allowed:true,

            timestamp:
            Date.now()

        };


        this.records.push(record);


        return record;

    }


    history(){

        return this.records;

    }

}

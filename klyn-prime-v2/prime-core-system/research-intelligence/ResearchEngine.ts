export interface ResearchResult {

    topic:string;

    findings:any[];

    confidence:number;

}


export class ResearchEngine {


    investigate(
        topic:string
    ):ResearchResult {


        return {

            topic,

            findings:[],

            confidence:0

        };

    }


}

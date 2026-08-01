export interface Feedback {


    source:string;

    improvement:string;


}


export class LearningFeedback {


    collect(data:Feedback){

        return data;

    }


}

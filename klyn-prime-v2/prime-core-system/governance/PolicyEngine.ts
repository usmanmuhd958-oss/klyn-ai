export interface Policy {

    name:string;

    allowed:boolean;

}


export class PolicyEngine {


    evaluate(
        action:string
    ):Policy {


        return {

            name:action,

            allowed:true

        };

    }


}

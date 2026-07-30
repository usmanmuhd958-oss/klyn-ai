export interface Experience {

    action:string;

    result:any;

    timestamp:number;

}


export class ExperienceMemory {


    private history:Experience[]=[];


    record(
        experience:Experience
    ){

        this.history.push(
            experience
        );

    }


    all(){

        return this.history;

    }

}

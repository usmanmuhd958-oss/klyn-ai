export class ExperienceRecorder {


    record(
        capability:string,
        result:any
    ){

        return {
            capability,
            result,
            timestamp:Date.now()
        };
    }

}

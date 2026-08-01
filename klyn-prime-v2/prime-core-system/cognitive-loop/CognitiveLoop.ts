export class CognitiveLoop {


    private running = false;


    start(){

        this.running = true;

        console.log(
            "[COGNITIVE LOOP] Started"
        );

    }


    stop(){

        this.running = false;

        console.log(
            "[COGNITIVE LOOP] Stopped"
        );

    }


    cycle(input:any){

        return {

            input,

            stage:
            "processed",

            timestamp:
            Date.now()

        };

    }


}

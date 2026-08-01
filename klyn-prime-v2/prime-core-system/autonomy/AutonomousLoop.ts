export class AutonomousLoop {


    private running = false;


    start(){

        this.running = true;

        console.log(
            "[AUTONOMY] Prime autonomous cycle started"
        );

    }


    stop(){

        this.running = false;

    }


    status(){

        return {

            active:this.running,

            cycle:
            "observe -> reason -> plan -> act -> learn"

        };

    }

}

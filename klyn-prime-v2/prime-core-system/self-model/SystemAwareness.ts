export class SystemAwareness {


    inspect(system:any){

        return {

            modules:
            Object.keys(system),

            awareness:
            "active",

            timestamp:
            Date.now()

        };

    }


}

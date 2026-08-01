export class RealityEngine {


    observe(system:any){

        return {

            snapshot:system,

            timestamp:Date.now()

        };

    }


}

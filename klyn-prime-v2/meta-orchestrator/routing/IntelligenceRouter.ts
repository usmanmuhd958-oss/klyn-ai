export class IntelligenceRouter {


    route(capability:string){

        const routes:any = {

            code:"Code Intelligence",

            planning:"Prime Brain",

            decision:"Decision Intelligence",

            deploy:"Software Factory"

        };


        return routes[capability] ?? "General Agent";

    }


}

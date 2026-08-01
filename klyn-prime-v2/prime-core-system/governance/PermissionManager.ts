export class PermissionManager {


    check(
        agent:string,
        action:string
    ){

        return {

            agent,

            action,

            permitted:true

        };

    }


}

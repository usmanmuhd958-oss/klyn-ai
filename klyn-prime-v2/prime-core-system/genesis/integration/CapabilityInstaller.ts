export class CapabilityInstaller {

    install(capability:any){

        console.log(
            "[GENESIS INSTALL]",
            capability
        );

        return {
            installed:true,
            capability
        };
    }
}

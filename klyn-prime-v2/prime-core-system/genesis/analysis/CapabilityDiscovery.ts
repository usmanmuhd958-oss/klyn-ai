export class CapabilityDiscovery {

    analyze(goal:string){

        return {
            goal,
            missingCapability:
            `Capability required for ${goal}`
        };
    }
}

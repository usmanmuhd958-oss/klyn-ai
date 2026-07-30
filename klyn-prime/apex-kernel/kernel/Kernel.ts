export interface Capability {
    name: string;
    version: string;
    execute(input: unknown): Promise<unknown>;
}


export class KlynKernel {

    private capabilities: Map<string, Capability>;

    constructor() {
        this.capabilities = new Map();
    }


    register(capability: Capability) {

        this.capabilities.set(
            capability.name,
            capability
        );

        console.log(
            `[KLYN] Capability registered: ${capability.name}`
        );
    }


    async execute(
        capabilityName: string,
        input: unknown
    ) {

        const capability =
            this.capabilities.get(capabilityName);


        if (!capability) {

            throw new Error(
                `Capability ${capabilityName} not found`
            );
        }


        return await capability.execute(input);
    }


    listCapabilities(){

        return Array.from(
            this.capabilities.keys()
        );

    }

}

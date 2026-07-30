export interface RuntimeModule {
    name: string;
    initialize(): Promise<void>;
    shutdown(): Promise<void>;
}


export class PrimeRuntime {

    private modules: RuntimeModule[] = [];

    async register(module: RuntimeModule) {
        this.modules.push(module);

        console.log(
            `[KLYN PRIME] Registered module: ${module.name}`
        );

        await module.initialize();
    }


    async start() {

        console.log(
            "[KLYN PRIME] Core Runtime Started"
        );


        for (const module of this.modules) {
            console.log(
                `[KLYN PRIME] Active: ${module.name}`
            );
        }
    }


    async stop() {

        for (const module of this.modules) {
            await module.shutdown();
        }

        console.log(
            "[KLYN PRIME] Runtime stopped"
        );
    }
}

export interface IntelligenceModule {
    name:string;
    initialize():Promise<void>;
    execute(input:any):Promise<any>;
}


export class ApexIntelligenceKernel {

    private modules:Map<string,IntelligenceModule>;

    constructor(){
        this.modules = new Map();
    }


    register(module:IntelligenceModule){

        this.modules.set(
            module.name,
            module
        );

        console.log(
            `[APEX] Module registered: ${module.name}`
        );
    }


    async boot(){

        console.log(
            "[APEX] Intelligence Kernel booting..."
        );


        for(const module of this.modules.values()){

            await module.initialize();

        }


        console.log(
            "[APEX] All intelligence systems online"
        );
    }



    async reason(input:any){

        const results=[];


        for(const module of this.modules.values()){

            results.push(
                await module.execute(input)
            );

        }


        return {
            timestamp:Date.now(),
            intelligence:results
        };
    }

}

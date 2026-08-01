export interface IntelligenceSystem {

    name:string;

    process(input:any):Promise<any>;

}


export class PrimeIntelligenceBridge {


    private systems =
        new Map<string, IntelligenceSystem>();


    connect(system:IntelligenceSystem){

        this.systems.set(
            system.name,
            system
        );

    }


    async execute(
        target:string,
        input:any
    ){

        const system =
            this.systems.get(target);


        if(!system){

            throw new Error(
                `Intelligence system ${target} unavailable`
            );

        }


        return await system.process(input);

    }


    listSystems(){

        return [
            ...this.systems.keys()
        ];

    }

}

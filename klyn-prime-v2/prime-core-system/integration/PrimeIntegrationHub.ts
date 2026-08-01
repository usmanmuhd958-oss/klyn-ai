export class PrimeIntegrationHub {


    private modules =
        new Map<string, any>();


    connect(
        name:string,
        module:any
    ){

        this.modules.set(
            name,
            module
        );

    }


    get(name:string){

        return this.modules.get(name);

    }


    status(){

        return [
            ...this.modules.keys()
        ];

    }


}

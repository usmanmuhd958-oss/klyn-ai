export class APIGenerator {

    generate(service:string){

        return {
            service,
            endpoints:[]
        };
    }
}

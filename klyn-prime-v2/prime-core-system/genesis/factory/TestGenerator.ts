export class TestGenerator {

    generate(module:string){

        return {
            module,
            tests:[
                "unit",
                "integration",
                "security"
            ]
        };
    }
}

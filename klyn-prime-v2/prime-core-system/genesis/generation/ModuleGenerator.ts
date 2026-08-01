export class ModuleGenerator {

    generate(architecture:any){

        return {
            generated:true,
            architecture,
            timestamp:Date.now()
        };
    }
}

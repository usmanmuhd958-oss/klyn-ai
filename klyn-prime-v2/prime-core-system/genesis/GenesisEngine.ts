import { CapabilityDiscovery } from "./analysis/CapabilityDiscovery";
import { SystemArchitect } from "./design/SystemArchitect";
import { ModuleGenerator } from "./generation/ModuleGenerator";
import { GenesisValidator } from "./validation/GenesisValidator";

export class GenesisEngine {

    private discovery = new CapabilityDiscovery();
    private architect = new SystemArchitect();
    private generator = new ModuleGenerator();
    private validator = new GenesisValidator();


    createCapability(goal:string){

        console.log("[GENESIS] Analyzing goal:", goal);

        const capability =
            this.discovery.analyze(goal);


        const architecture =
            this.architect.design(capability);


        const module =
            this.generator.generate(architecture);


        const result =
            this.validator.validate(module);


        return {
            capability,
            architecture,
            module,
            valid: result
        };
    }
}

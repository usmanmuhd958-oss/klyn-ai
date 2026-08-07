export class SpecialistAgentFactory {

    private layer = "V638";

    coordinate(input: unknown) {
        return {
            layer: this.layer,
            module: "SpecialistAgentFactory",
            status: "active",
            agentInput: input
        };
    }

}

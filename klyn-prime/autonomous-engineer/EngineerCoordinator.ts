import { ArchitectAgent } from "./ArchitectAgent";
import { PlannerAgent } from "./PlannerAgent";
import { DeveloperAgent } from "./DeveloperAgent";
import { ReviewerAgent } from "./ReviewerAgent";
import { SecurityAgent } from "./SecurityAgent";
import { TestAgent } from "./TestAgent";


export class EngineerCoordinator {

    private architect;
    private planner;
    private developer;
    private reviewer;
    private security;
    private tester;


    constructor(){

        this.architect = new ArchitectAgent();
        this.planner = new PlannerAgent();
        this.developer = new DeveloperAgent();
        this.reviewer = new ReviewerAgent();
        this.security = new SecurityAgent();
        this.tester = new TestAgent();

    }


    async executeMission(
        mission:string
    ){

        const architecture =
            await this.architect.design(mission);


        const plan =
            await this.planner.createPlan(
                architecture
            );


        const code =
            await this.developer.build(
                plan
            );


        const review =
            await this.reviewer.review(
                code
            );


        const security =
            await this.security.scan(
                code
            );


        const tests =
            await this.tester.validate(
                code
            );


        return {
            architecture,
            plan,
            code,
            review,
            security,
            tests
        };

    }

}

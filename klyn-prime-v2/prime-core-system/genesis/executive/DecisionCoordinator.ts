export class DecisionCoordinator {

    decide(options:any[]){

        return {
            selected: options[0],
            reason:"highest priority"
        };
    }
}

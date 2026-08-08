export class RuntimeCoordinator {

    coordinate(tasks:string[]){
        return tasks.map(task=>({
            task,
            state:"scheduled"
        }));
    }
}

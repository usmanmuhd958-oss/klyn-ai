export class CapabilityLifecycle {

    state="created";

    transition(next:string){

        this.state = next;

        return this.state;
    }
}

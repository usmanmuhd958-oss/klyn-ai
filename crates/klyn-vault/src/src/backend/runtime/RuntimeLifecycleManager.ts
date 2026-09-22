export type RuntimeState =
  | "CREATED"
  | "INITIALIZED"
  | "RUNNING"
  | "STOPPED";


export class RuntimeLifecycleManager {

  private state: RuntimeState = "CREATED";


  start() {
    this.state = "RUNNING";

    return {
      success: true,
      state: this.state
    };
  }


  stop() {
    this.state = "STOPPED";

    return {
      success: true,
      state: this.state
    };
  }


  status() {
    return this.state;
  }

}

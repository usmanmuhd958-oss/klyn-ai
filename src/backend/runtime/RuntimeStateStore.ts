export class RuntimeStateStore {

  private state = "CREATED";

  setState(value:string) {
    this.state = value;
  }

  getState() {
    return {
      state: this.state,
      timestamp: Date.now()
    };
  }
}

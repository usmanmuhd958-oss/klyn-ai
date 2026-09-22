import { RuntimeStateStore } from "./RuntimeStateStore.js";

export class BackendBootstrapController {

  constructor(
    private state: RuntimeStateStore
  ) {}

  async boot() {

    this.state.setState("BOOTING");

    this.state.setState("READY");

    return {
      success:true,
      state:this.state.getState()
    };
  }
}

/**
 * KLYN AI OS - CONTROLLER LAYER
 */

import { CoreService } from "./core";

export class Controller {

  private core = new CoreService();

  async handle(request: unknown) {
    return await this.core.execute(request);
  }
}

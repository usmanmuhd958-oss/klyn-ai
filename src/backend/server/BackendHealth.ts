import { BackendKernel } from "../core/BackendKernel.js";

const kernel = new BackendKernel();

export function healthCheck() {

  return kernel.boot();

}

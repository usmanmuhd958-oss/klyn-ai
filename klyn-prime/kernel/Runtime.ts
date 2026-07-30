import { KlynKernel } from "./Kernel";


export class KlynRuntime {

  kernel: KlynKernel;


  constructor() {
    this.kernel = new KlynKernel();
  }


  async boot() {

    console.log(
      "[KLYN PRIME] Booting Intelligence Runtime..."
    );


    console.log(
      this.kernel.status()
    );

  }

}

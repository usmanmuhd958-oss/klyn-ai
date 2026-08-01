import { GenesisEngine } 
from "../GenesisEngine";


export class GenesisKernelBridge {

    private genesis =
        new GenesisEngine();


    activate(){

        console.log(
            "[GENESIS] Connected to Prime Kernel"
        );
    }


    createSystemCapability(goal:string){

        return this.genesis.createCapability(goal);
    }
}

export class PrimeSystemKernel {

    private systems = new Map<string, any>();

    register(name:string, system:any){
        this.systems.set(name, system);
    }

    get(name:string){
        return this.systems.get(name);
    }

    boot(){
        console.log(
        "[KLYN PRIME] System Kernel Online"
        );

        for(const [name] of this.systems){
            console.log(
            `[SYSTEM ACTIVE] ${name}`
            );
        }
    }
}

export class GenesisValidator {

    validate(module:any){

        return Boolean(module.generated);
    }
}

export class RollbackManager {

    rollback(version:string){

        return {
            restored:version,
            status:"rollback-complete"
        };
    }
}

export class DatabaseDesigner {

    createSchema(domain:string){

        return {
            domain,
            schema:"generated"
        };
    }
}

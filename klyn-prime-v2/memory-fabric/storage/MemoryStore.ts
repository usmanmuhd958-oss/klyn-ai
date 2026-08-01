export class MemoryStore {


    save(data:any){

        return {

            saved:true,

            data

        };

    }


    load(){

        return [];

    }


}

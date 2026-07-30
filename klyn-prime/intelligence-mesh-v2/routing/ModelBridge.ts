export class ModelBridge {


    async select(
        task:string
    ){

        return {

            task,

            selected:
            "best-available-model"

        };

    }


}

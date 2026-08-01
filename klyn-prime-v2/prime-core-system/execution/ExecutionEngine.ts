export interface ExecutionTask {

    id:string;

    name:string;

    execute:()=>Promise<any>;

}


export class ExecutionEngine {


    async run(
        task:ExecutionTask
    ){

        try{

            const result =
                await task.execute();


            return {

                success:true,

                task:task.name,

                result

            };


        }catch(error){

            return {

                success:false,

                task:task.name,

                error

            };

        }

    }


    async runPipeline(
        tasks:ExecutionTask[]
    ){

        const results=[];


        for(const task of tasks){

            results.push(
                await this.run(task)
            );

        }


        return results;

    }

}

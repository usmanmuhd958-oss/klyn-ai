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


    async runParallel(
        tasks: ExecutionTask[],
        concurrency: number = 8
    ){

        const results: any[] = new Array(tasks.length);

        const executing: Promise<void>[] = [];


        for (let i = 0; i < tasks.length; i++) {

            const task = tasks[i];

            const promise = this.run(task).then(result => {

                results[i] = result;

            });


            executing.push(promise);


            if (executing.length >= concurrency) {

                await Promise.race(executing);

                executing.splice(

                    executing.findIndex(p => p === promise),

                    1

                );

            }

        }


        await Promise.all(executing);


        return results;

    }


    async runParallelSettled(
        tasks: ExecutionTask[],
        concurrency: number = 8
    ){

        const results: any[] = new Array(tasks.length);

        const executing: Promise<void>[] = [];


        for (let i = 0; i < tasks.length; i++) {

            const task = tasks[i];

            const promise = this.run(task).then(result => {

                results[i] = result;

            }).catch(error => {

                results[i] = {

                    success: false,

                    task: task.name,

                    error

                };

            });


            executing.push(promise);


            if (executing.length >= concurrency) {

                await Promise.race(executing);

                executing.splice(

                    executing.findIndex(p => p === promise),

                    1

                );

            }

        }


        await Promise.all(executing);


        return results;

    }

}

export class ParallelExecutor {


 async execute(tasks:any[]){

  const results = await Promise.all(

   tasks.map(async task=>({

    task,

    status:"COMPLETED"

   }))

  );


  return results;


 }


}

export class RetryManager {

  async execute(
    fn:()=>Promise<any>,
    retries:number = 3
  ){

    let lastError;

    for(let i=0;i<retries;i++){

      try{
        return await fn();
      }
      catch(error){
        lastError = error;
      }

    }

    throw lastError;

  }

}

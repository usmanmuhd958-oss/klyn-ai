export class TransactionManager {

  async execute<T>(operation:()=>Promise<T>):Promise<T>{

    return await operation();

  }

}

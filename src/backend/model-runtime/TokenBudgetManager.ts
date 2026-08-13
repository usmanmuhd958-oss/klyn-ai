export class TokenBudgetManager {


  allocate(task:any){

    return {

      budget:task?.budget ?? 1000

    };

  }


}

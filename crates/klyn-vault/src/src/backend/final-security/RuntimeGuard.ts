export class RuntimeGuard {

  protect(runtime:any){

    return {
      protected:true,
      runtime
    };

  }

}

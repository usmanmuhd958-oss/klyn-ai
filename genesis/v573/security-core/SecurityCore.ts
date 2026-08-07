export class SecurityCore {
  protect(system:any){
    return {
      system,
      security:"active"
    };
  }
}

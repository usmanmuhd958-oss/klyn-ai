export class LicenseManager {

 issue(user:string){

  return {
   user,
   license:"ACTIVE"
  };

 }

}

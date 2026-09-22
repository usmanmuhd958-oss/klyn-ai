export class BackupManager {

 createBackup(data:any){

  return {
   backup:true,
   createdAt:Date.now(),
   data
  };

 }

}

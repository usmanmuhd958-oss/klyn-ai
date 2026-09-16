export class RepositoryIndexer {


 index(files:string[]){

  return {

   totalFiles:files.length,

   indexed:true

  };

 }


}

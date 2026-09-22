import fs from "node:fs";
import path from "node:path";

export class RepositoryScanner {

 scan(directory:string){

  const files:string[]=[];

  const walk=(dir:string)=>{

   for(const item of fs.readdirSync(dir)){

    const full=path.join(dir,item);

    if(fs.statSync(full).isDirectory()){

     walk(full);

    }else{

     files.push(full);

    }

   }

  };

  walk(directory);

  return files;

 }

}

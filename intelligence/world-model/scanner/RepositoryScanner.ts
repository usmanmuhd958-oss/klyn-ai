
import fs from "fs";
import path from "path";


export class RepositoryScanner {


 scan(directory:string){

    const files:string[]=[];


    const walk=(dir:string)=>{

        for(const file of fs.readdirSync(dir)){

            const full=
            path.join(dir,file);


            if(fs.statSync(full).isDirectory()){

                walk(full);

            } else {

                files.push(full);

            }

        }

    };


    walk(directory);


    return files;

 }

}


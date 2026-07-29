export class Supervisor{
  [key: string]: any;watch(f){setInterval(()=>{try{f()}catch(e){console.log("[SUPERVISOR] Recovered")}},100)}}

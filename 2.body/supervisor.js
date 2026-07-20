export class Supervisor{watch(f){setInterval(()=>{try{f()}catch(e){console.log("[SUPERVISOR] Recovered")}},100)}}

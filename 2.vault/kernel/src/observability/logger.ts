// [KLYN-AST-GUARD] Verified & Protected by Klyn OS Kernel
'use strict';const fs=require('fs'),path=require('path'),LOG_DIR=path.join('/data/data/com.termux/files/home/klyn-ai-os','runtime','logs');
function createLogger(name){return{info:(m,meta)=>{const line=`[INFO][${name}] ${m} ${meta?JSON.stringify(meta):''}`;fs.appendFileSync(path.join(LOG_DIR,`${name}.log`),line+'\n');},error:(m,meta)=>{const line=`[ERROR][${name}] ${m} ${meta?JSON.stringify(meta):''}`;fs.appendFileSync(path.join(LOG_DIR,`${name}.log`),line+'\n');},warn:(m,meta)=>{const line=`[WARN][${name}] ${m} ${meta?JSON.stringify(meta):''}`;fs.appendFileSync(path.join(LOG_DIR,`${name}.log`),line+'\n');},debug:()=>{}}}
function generateCorrelationId(){return `corr_${Date.now()}_${Math.random().toString(36).slice(2,9)}`}
module.exports={createLogger,generateCorrelationId}


export {};

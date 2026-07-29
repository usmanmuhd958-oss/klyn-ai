export class Memory{
  [key: string]: any;constructor(){this.store=new Map()}save(k,v){this.store.set(k,v)}load(k){return this.store.get(k)}}

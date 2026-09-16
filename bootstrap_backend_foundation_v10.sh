#!/usr/bin/env bash

set -e

echo "======================================"
echo " KLYN BACKEND FOUNDATION V10"
echo " EVENT BUS + ASYNC NERVOUS SYSTEM"
echo "======================================"

mkdir -p src/backend/events


cat > src/backend/events/EventTypes.ts <<'TS'
export type BackendEventType =
 | "RUNTIME_STARTED"
 | "RUNTIME_STOPPED"
 | "MEMORY_UPDATED"
 | "SERVICE_REGISTERED"
 | "TASK_EXECUTED"
 | "ERROR_OCCURRED";


export interface BackendEvent {

 id:string;

 type:BackendEventType;

 payload:unknown;

 timestamp:number;

}
TS


cat > src/backend/events/EventEmitter.ts <<'TS'
import { BackendEvent } from "./EventTypes";


export class EventEmitter {

 private listeners =
 new Map<string,Function[]>();


 on(event:string,callback:Function){

   const handlers =
   this.listeners.get(event) || [];

   handlers.push(callback);

   this.listeners.set(event,handlers);

 }


 emit(event:BackendEvent){

   const handlers =
   this.listeners.get(event.type) || [];


   for(const handler of handlers){

     handler(event);

   }

 }

}
TS


cat > src/backend/events/EventBus.ts <<'TS'
import { EventEmitter } from "./EventEmitter";
import { BackendEvent } from "./EventTypes";


export class EventBus {

 private emitter =
 new EventEmitter();


 subscribe(
  type:string,
  handler:Function
 ){

  this.emitter.on(type,handler);

 }


 publish(event:BackendEvent){

  this.emitter.emit(event);

  return {
    published:true,
    event:event.type
  };

 }

}
TS


cat > src/backend/events/EventStore.ts <<'TS'
import { BackendEvent } from "./EventTypes";


export class EventStore {

 private events:BackendEvent[]=[];


 append(event:BackendEvent){

   this.events.push(event);

 }


 all(){

   return this.events;

 }

}
TS


cat > src/backend/events/EventDispatcher.ts <<'TS'
import { EventBus } from "./EventBus";
import { BackendEvent } from "./EventTypes";


export class EventDispatcher {

 constructor(
  private bus=new EventBus()
 ){}


 dispatch(event:BackendEvent){

   return this.bus.publish(event);

 }


 getBus(){

   return this.bus;

 }

}
TS


cat > src/backend/events/AsyncEventProcessor.ts <<'TS'
import { BackendEvent } from "./EventTypes";


export class AsyncEventProcessor {


 async process(
   event:BackendEvent
 ){

   return {

    processed:true,

    type:event.type

   };

 }


}
TS


echo
echo "======================================"
echo " BACKEND FOUNDATION V10 READY"
echo " EVENT SYSTEM ONLINE"
echo "======================================"


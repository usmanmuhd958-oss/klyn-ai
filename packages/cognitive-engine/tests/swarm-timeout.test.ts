import assert from "node:assert/strict";
import test from "node:test";
import { DagTimeoutError, deterministicIdempotencyKey, SwarmDagOrchestrator } from "../src/swarm/DagOrchestrator.js";

test("idempotency key is deterministic",()=>{const task={id:"a",agentId:"agent",input:{x:1},dependsOn:["b"]};assert.equal(deterministicIdempotencyKey(task),deterministicIdempotencyKey({...task}));});
test("timeout aborts the swarm and rolls back completed work",async()=>{let rolled=false;const dag=new SwarmDagOrchestrator().addTask({id:"fast",agentId:"a",input:null,run:async()=>1,rollback:async()=>{rolled=true;}}).addTask({id:"slow",agentId:"b",input:null,dependsOn:["fast"],run:async()=>new Promise(r=>setTimeout(r,100))});await assert.rejects(dag.execute({timeoutMs:10}),DagTimeoutError);assert.equal(rolled,true);});
test("external cancellation propagates to running task",async()=>{const controller=new AbortController();const dag=new SwarmDagOrchestrator().addTask({id:"a",agentId:"a",input:null,run:async(_c,signal)=>new Promise((resolve,reject)=>{signal!.addEventListener("abort",()=>reject(new Error("aborted")),{once:true});setTimeout(()=>resolve("late"),100);})});const promise=dag.execute({signal:controller.signal});setTimeout(()=>controller.abort(),5);await assert.rejects(promise);});

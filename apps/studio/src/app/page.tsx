"use client";

import {
  useEffect,
} from "react";

import {
  useStudioStore,
} from "@/store/useStudioStore";

import StudioShell
from "@/components/layout/StudioShell";

export default function Home(){

 const {
  addFile,
  registerAgent,
  setActiveFile,
 } = useStudioStore();

 useEffect(()=>{
  const store = useStudioStore.getState();

  /**
   * Prevent duplicate initialization
   */
  if(store.files.length > 0) return;

  const starterFile = {
    id:"main-ts",
    name:"main.ts",
    path:"src/main.ts",
    language:"typescript",
    content:
`export function helloKlyn(){
  return "Klyn AI Studio";
}`,
    modified:false,
    createdAt:Date.now(),
    updatedAt:Date.now()
  };

  addFile(starterFile);
  setActiveFile(starterFile.id);

  registerAgent({
    id:"architect",
    name:"Architect Agent",
    role:"architect",
    status:"idle",
    tokensUsed:0,
    connectedAgents:[
      "coder",
      "tester"
    ]
  });

  registerAgent({
    id:"coder",
    name:"Backend Engineer",
    role:"backend-engineer",
    status:"idle",
    tokensUsed:0,
    connectedAgents:[
      "architect"
    ]
  });

  registerAgent({
    id:"tester",
    name:"Testing Agent",
    role:"tester",
    status:"idle",
    tokensUsed:0,
    connectedAgents:[
      "coder"
    ]
  });

 },[
   addFile,
   registerAgent,
   setActiveFile
 ]);

 return (
   <StudioShell/>
 );
}

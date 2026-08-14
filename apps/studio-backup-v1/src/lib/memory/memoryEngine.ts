import type {
 MemoryNode,
 MemoryLink
} from "@/types/memory/memory.types";


const memories:MemoryNode[]=[];

const links:MemoryLink[]=[];


export function storeMemory(
memory:MemoryNode
){

memories.push(memory);

}


export function connectMemory(
link:MemoryLink
){

links.push(link);

}


export function getMemoryGraph(){

return {
memories,
links
};

}

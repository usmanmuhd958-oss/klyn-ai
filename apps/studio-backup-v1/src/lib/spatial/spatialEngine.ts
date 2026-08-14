import type {
 SpatialNode,
 SpatialConnection
} from "@/types/spatial/spatial.types";


const nodes:SpatialNode[]=[];

const connections:SpatialConnection[]=[];


export function registerNode(
node:SpatialNode
){

nodes.push(node);

}


export function connectNodes(
connection:SpatialConnection
){

connections.push(connection);

}


export function getSpatialMap(){

return {
nodes,
connections
};

}

"use client";

import {useState} from "react";
import type {AgentRuntimeEvent} from "./event.types";


export function useAgentStream(){

const [events,setEvents]=useState<AgentRuntimeEvent[]>([]);


function pushEvent(
event:AgentRuntimeEvent
){

setEvents(previous=>[
...previous,
event
]);

}


return {

events,

pushEvent

};

}

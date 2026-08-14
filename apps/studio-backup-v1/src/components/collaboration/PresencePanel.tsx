"use client";

import {useEffect,useState} from "react";
import {getPresence} from "@/lib/collaboration/workspaceSync";


export default function PresencePanel(){

const [users,setUsers]=useState<any[]>([]);


useEffect(()=>{

const timer=setInterval(()=>{
 setUsers(getPresence());
},1000);


return ()=>clearInterval(timer);

},[]);


return (

<div className="glass-panel p-3 font-mono">

<div className="text-xs uppercase">
Realtime Presence
</div>


{users.map(user=>(

<div
key={user.userId}
className="text-[10px]"
>
● {user.name} — {user.status}

</div>

))}


</div>

);

}

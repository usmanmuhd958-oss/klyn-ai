"use client";

import {useState} from "react";
import {calculateHealth} from "@/lib/deployment/pipelineEngine";

export default function DeploymentCenter(){

const [health]=useState(
calculateHealth({
uptime:98,
errors:2,
latency:5
})
);


return (

<div className="glass-panel p-3 font-mono">

<div className="uppercase text-xs">
Deployment Intelligence
</div>

<div className="text-[11px] mt-2">
Release Health Score:
{health}%
</div>

<div className="text-[10px] text-ink-dim mt-2">
CI/CD reasoning active
</div>

</div>

);

}

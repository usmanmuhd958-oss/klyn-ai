"use client";

import {
getPolicies
}
from "@/lib/governance/policyEngine";


export default function GovernanceDashboard(){

const policies=getPolicies();


return (

<div className="absolute inset-0 p-6">

<div className="font-mono text-xs text-cyan-300">
KLYN Governance Intelligence
</div>


{
policies.map(policy=>(

<div
key={policy.id}
className="mt-3 rounded-xl border border-cyan-400/30 bg-black/40 p-3 text-xs"
>

{policy.name}

<br/>

Scope: {policy.scope}

<br/>

Status:
{policy.enabled ? " Active":" Disabled"}

</div>

))

}

</div>

);

}

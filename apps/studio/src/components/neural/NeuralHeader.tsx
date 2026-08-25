"use client";

import { Search } from "lucide-react";

export default function NeuralHeader(){

return (
<header className="
flex items-center justify-between
rounded-2xl
border border-white/10
bg-white/5
px-6 py-4
">

<div>
<h1 className="text-xl font-bold">
KLYN NEURAL OS
</h1>

<p className="text-xs text-gray-400">
Autonomous Engineering Intelligence
</p>
</div>

<div className="
flex items-center gap-2
rounded-xl
border border-white/10
px-4 py-2
text-sm text-gray-400
">

<Search size={16}/>

Command Center

<span className="text-white">
⌘K
</span>

</div>

</header>
);

}

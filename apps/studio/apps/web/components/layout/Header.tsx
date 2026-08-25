"use client";

import {Activity,Brain,Shield} from "lucide-react";

export default function Header(){

return (
<header className="glass h-16 flex items-center justify-between px-6">
<div className="text-xl font-bold text-cyan-300">
◈ KLYN STUDIO
</div>

<div className="flex gap-5 text-sm">
<span><Brain/> Architect Online</span>
<span><Activity/> Builder Active</span>
<span><Shield/> Guard Ready</span>
</div>

<div className="px-4 py-2 rounded-full border border-cyan-500/30">
Intent Verified
</div>

</header>
);
}

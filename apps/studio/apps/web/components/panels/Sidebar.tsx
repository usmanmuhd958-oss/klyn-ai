export default function Sidebar(){

return (
<aside className="glass w-72 p-5 space-y-6">

<h2 className="text-cyan-300">
Intent Explorer
</h2>

<textarea
className="w-full h-32 bg-black/30 rounded-xl p-3 border border-cyan-500/20"
placeholder="Describe your mission..."
/>

<div>
<h3>Requirement Graph</h3>
<ul className="text-sm text-slate-300">
<li>Authentication</li>
<li>API Architecture</li>
<li>Database Layer</li>
<li>Verification Rules</li>
</ul>
</div>

</aside>
);
}

export default function StatusBar(){

return (
<div className="fixed bottom-5 left-5 right-5 glass rounded-2xl p-4 flex justify-between">
<span>Swarm: 3 Agents Online</span>
<span>Latent Intent: Active</span>

<div className="w-64 h-2 bg-slate-700 rounded">
<div className="h-full w-3/4 bg-cyan-400 rounded"/>
</div>

</div>
);
}

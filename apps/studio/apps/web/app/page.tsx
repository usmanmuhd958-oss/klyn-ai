import Header from "../components/layout/Header";
import Sidebar from "../components/panels/Sidebar";
import AgentTerminal from "../components/panels/AgentTerminal";
import SpatialIntentCanvas from "../components/canvas/SpatialIntentCanvas";
import StatusBar from "../components/ui/StatusBar";

export default function Page(){

return (
<main className="h-screen flex flex-col gap-3 p-3">

<Header/>

<div className="flex flex-1 gap-3">

<Sidebar/>

<div className="flex-1 glass rounded-2xl">
<SpatialIntentCanvas/>
</div>

<AgentTerminal/>

</div>

<StatusBar/>

</main>
);
}

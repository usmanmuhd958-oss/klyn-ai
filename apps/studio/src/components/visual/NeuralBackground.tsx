"use client";

export default function NeuralBackground(){

return (
<div className="
pointer-events-none
absolute
inset-0
overflow-hidden
opacity-40
">

<div className="
absolute
left-1/2
top-1/3
h-96
w-96
-translate-x-1/2
rounded-full
bg-blue-500/20
blur-3xl
animate-pulse
"/>

<div className="
absolute
right-10
top-20
h-72
w-72
rounded-full
bg-purple-500/20
blur-3xl
animate-pulse
"/>

</div>
);

}

"use client";

import { useState } from "react";

interface Props {
  onSubmit?: (value:string)=>void;
}

export default function IntentInput({onSubmit}:Props){

  const [value,setValue]=useState("");

  function submit(){

    if(!value.trim()) return;

    onSubmit?.(value);

    setValue("");

  }


  return (
    <div className="w-full max-w-3xl">

      <input

        value={value}

        onChange={(e)=>setValue(e.target.value)}

        onKeyDown={(e)=>{
          if(e.key==="Enter"){
            submit();
          }
        }}

        placeholder="Describe what you want to build..."

        className="
        w-full
        rounded-xl
        border
        border-white/10
        bg-black/40
        px-6
        py-4
        text-white
        outline-none
        backdrop-blur-md
        "

      />

    </div>
  );

}

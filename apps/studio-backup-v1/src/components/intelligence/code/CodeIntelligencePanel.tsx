"use client";

import { useState } from "react";

export default function CodeIntelligencePanel(){

 const [status,setStatus] =
 useState("waiting");

 return (
  <div className="glass-panel rounded-md p-4 font-mono">
    <div className="text-xs uppercase tracking-widest">
      KLYN Code Intelligence
    </div>

    <div className="mt-3 text-sm">
      Status:
      {" "}
      {status}
    </div>

    <button
      className="mt-3 border px-3 py-1"
      onClick={() =>
        setStatus("repository analyzed")
      }
    >
      Analyze Repository
    </button>

  </div>
 );
}

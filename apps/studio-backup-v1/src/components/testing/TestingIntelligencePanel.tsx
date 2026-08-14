
"use client";

import {useState} from "react";
import {generateTests} from "@/lib/testing/testGenerator";
import {calculateQuality} from "@/lib/testing/qualityEngine";


export default function TestingIntelligencePanel(){

const [result,setResult]=useState<any>(null);


function run(){

const tests=
generateTests(
"workspace/source.ts"
);

setResult({

tests,

score:
calculateQuality(tests)

});

}


return (

<div className="glass-panel p-4 font-mono">

<h2 className="text-xs uppercase">
Autonomous Testing Intelligence
</h2>


<button
onClick={run}
className="mt-3 border px-3 py-1"
>
Generate Tests
</button>


{
result &&
<div className="mt-3 text-xs">

<p>
Quality Score:
{result.score.overall}%
</p>

<p>
Tests Generated:
{result.tests.length}
</p>

</div>
}


</div>

);

}


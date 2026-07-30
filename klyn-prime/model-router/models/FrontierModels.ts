import { ModelProfile } from "../ModelRegistry";


export const FrontierModels:ModelProfile[] = [

{
id:"claude-opus",
provider:"Anthropic",
strengths:[
"architecture",
"reasoning",
"large refactor"
],
tasks:[
"system-design",
"code-review"
],
speed:8,
quality:10
},


{
id:"gpt-codex",
provider:"OpenAI",
strengths:[
"coding",
"debugging",
"implementation"
],
tasks:[
"development",
"bug-fix"
],
speed:9,
quality:10
},


{
id:"gemini-pro",
provider:"Google",
strengths:[
"context",
"multimodal",
"analysis"
],
tasks:[
"large-repository",
"research"
],
speed:9,
quality:9
},


{
id:"deepseek-coder",
provider:"DeepSeek",
strengths:[
"coding",
"cost-efficiency"
],
tasks:[
"implementation"
],
speed:10,
quality:8
},


{
id:"qwen-coder",
provider:"Alibaba",
strengths:[
"open-model",
"coding"
],
tasks:[
"local-development"
],
speed:9,
quality:8
},


{
id:"mistral-codestral",
provider:"Mistral",
strengths:[
"fast-code"
],
tasks:[
"completion"
],
speed:10,
quality:8
},


{
id:"llama-coder",
provider:"Meta",
strengths:[
"local-ai"
],
tasks:[
"private-development"
],
speed:8,
quality:8
},


{
id:"grok-code",
provider:"xAI",
strengths:[
"reasoning"
],
tasks:[
"complex-analysis"
],
speed:8,
quality:8
},


{
id:"kimi-coder",
provider:"Moonshot",
strengths:[
"long-context",
"engineering"
],
tasks:[
"large-project"
],
speed:8,
quality:9
},


{
id:"codestral-fast",
provider:"Mistral",
strengths:[
"low-latency"
],
tasks:[
"autocomplete"
],
speed:10,
quality:7
},


{
id:"command-r",
provider:"Cohere",
strengths:[
"enterprise"
],
tasks:[
"business-ai"
],
speed:8,
quality:8
},


{
id:"local-specialist",
provider:"Local",
strengths:[
"privacy",
"offline"
],
tasks:[
"private-tasks"
],
speed:10,
quality:7
}

];

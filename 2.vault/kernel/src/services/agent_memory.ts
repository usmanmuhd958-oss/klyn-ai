// [KLYN-AST-GUARD] Verified & Protected by Klyn OS Kernel
const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, '..', '..', 'runtime', 'agent_memory.json');

function readData() {
    try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch(e) {
        return { tasks: [], knowledge: {}, model_stats: {} };
    }
}

function writeData(data) { fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true }); fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2)); }

function recordTask(agent, task, model, result, responseTime, success) {
    const data = readData();
    (data as any).tasks.push({ agent, task, model, result: JSON.stringify(result).substring(0, 500), responseTime, success, at: new Date().toISOString() });
    if (!(data as any).model_stats[model]) (data as any).model_stats[model] = { total_calls: 0, success_calls: 0, avg_response_ms: 0, last_used: null };
    const s = (data as any).model_stats[model];
    s.total_calls += 1;
    if (success) s.success_calls += 1;
    s.avg_response_ms = ((s.avg_response_ms * (s.total_calls - 1)) + responseTime) / s.total_calls;
    s.last_used = new Date().toISOString();
    writeData(data);
}

function recallSimilar(task) {
    const data = readData();
    return (data as any).tasks.filter(t => t.task && t.task.includes(task.substring(0, 30))).slice(-5).reverse();
}

function getBestModel() {
    const data = readData();
    let best = 'local';
    let bestScore = -1;
    for (const [model, stats] of Object.entries((data as any).model_stats)) {
        if ((stats as any).total_calls > 0) {
            const score = ((stats as any).success_calls / (stats as any).total_calls) * 100 - ((stats as any).avg_response_ms / 1000);
            if (score > bestScore) { bestScore = score; best = model; }
        }
    }
    return best;
}

function learnFact(key, value, confidence = 0.8) {
    const data = readData();
    (data as any).knowledge[key] = { value, confidence, at: new Date().toISOString() };
    writeData(data);
}

// CLI
if (require.main === module) {
    const cmd = process.argv[2];
    if (cmd === 'best') console.log(getBestModel());
    else if (cmd === 'recall') console.log(JSON.stringify(recallSimilar(process.argv[3] || '')));
    else if (cmd === 'learn') learnFact(process.argv[3], process.argv[4], parseFloat(process.argv[5]) || 0.8);
    else if (cmd === 'stats') {
        const data = readData();
        const out = Object.entries((data as any).model_stats).map(([model, stats]) => ({ model, ...(stats as any) }));
        console.log(JSON.stringify(out));
    }
}
module.exports = { recordTask, recallSimilar, getBestModel, learnFact };


export {};

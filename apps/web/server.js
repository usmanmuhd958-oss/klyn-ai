const express = require('express');
const path = require('path');
const { exec } = require('child_process');
const app = express();
app.use(express.static(path.join(__dirname, 'public')));
app.get('/api/health', (req, res) => {
    exec('bash ../../scripts/health_check.sh', (err, stdout) => {
        res.json({ status: err ? 'unhealthy' : 'healthy', details: stdout });
    });
});
app.get('/api/agents', (req, res) => {
    res.json(['coder', 'planner', 'reviewer', 'researcher']);
});
app.listen(4000, () => console.log('Dashboard on http://localhost:4000'));

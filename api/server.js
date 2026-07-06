const express = require('express');
const jwt = require('jsonwebtoken');
const { exec } = require('child_process');
const app = express();
app.use(express.json());

const SECRET = process.env.JWT_SECRET || 'klyn-secret-change-me';

function authMiddleware(req, res, next) {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({error:'Missing token'});
    try {
        req.user = jwt.verify(token, SECRET);
        next();
    } catch(e) {
        res.status(401).json({error:'Invalid token'});
    }
}

app.post('/auth/login', (req,res) => {
    const { username, password } = req.body;
    if (username === 'admin' && password === (process.env.ADMIN_PASSWORD || 'klyn')) {
        const token = jwt.sign({ username }, SECRET, { expiresIn: '24h' });
        res.json({ token });
    } else {
        res.status(403).json({ error: 'Invalid credentials' });
    }
});

app.get('/status', authMiddleware, (req,res) => {
    exec('bash scripts/health_check.sh', (err, stdout) => {
        res.json({ status: err ? 'unhealthy' : 'healthy', output: stdout });
    });
});

app.post('/agent/run', authMiddleware, (req,res) => {
    const { agent, task } = req.body;
    exec(`bash agents/src/${agent}.sh "${task}"`, (err, stdout) => {
        res.json({ result: stdout, error: err?.message });
    });
});

app.listen(3000, () => console.log('Klyn API (secured) on port 3000'));

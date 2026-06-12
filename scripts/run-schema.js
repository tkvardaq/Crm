const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const sqlPath = path.join(__dirname, 'schema.sql');
const sql = fs.readFileSync(sqlPath, 'utf8');

const ps = spawn('docker', ['exec', '-i', 'leadstealth-postgres', 'psql', '-U', 'admin', '-d', 'leadstealth_db'], {
  stdio: ['pipe', 'inherit', 'inherit']
});

ps.stdin.write(sql);
ps.stdin.end();

ps.on('close', (code) => {
  process.exit(code);
});

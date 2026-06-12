const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const sqlPath = path.join(__dirname, 'schema.sql');
const sql = fs.readFileSync(sqlPath, 'utf8');

const proc = spawn('docker', ['exec', '-i', 'leadstealth-postgres', 'psql', '-U', 'admin', '-d', 'leadstealth_db'], {
  stdio: ['pipe', 'inherit', 'pipe']
});

proc.stdin.write(sql);
proc.stdin.end();

proc.on('exit', (code) => process.exit(code || 0));
proc.on('error', (err) => { console.error(err); process.exit(1); });

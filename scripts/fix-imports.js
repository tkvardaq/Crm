const fs = require('fs');
const path = require('path');

const root = 'D:/AI/crm tool/apps/web/app/api';

function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      walk(full);
    } else if (e.name.endsWith('.ts')) {
      let c = fs.readFileSync(full, 'utf8');
      const changed = c.includes('from "@prisma/client"');
      if (changed) {
        c = c.replace(/from "@prisma\/client"/g, 'from "@crm/database"');
        fs.writeFileSync(full, c);
        console.log('Fixed:', full);
      }
    }
  }
}

walk(root);
console.log('Done');
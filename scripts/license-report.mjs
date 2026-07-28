import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
const packages = Object.entries(lock.packages ?? {})
  .filter(([name]) => name.startsWith('node_modules/'))
  .map(([name, value]) => ({
    name: name.replace(/^node_modules\//, ''),
    version: value.version ?? 'unknown',
    license: value.license ?? 'UNKNOWN',
  }))
  .sort((left, right) => left.name.localeCompare(right.name));

const reportDir = path.join(root, 'reports');
fs.mkdirSync(reportDir, { recursive: true });
fs.writeFileSync(
  path.join(reportDir, 'licenses.json'),
  `${JSON.stringify({ generatedAt: new Date().toISOString(), packages }, null, 2)}\n`,
);
console.log(`Recorded ${packages.length} package licenses.`);

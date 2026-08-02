import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
const licenseOverrides = new Map([['khroma', 'MIT']]);
const selectedAlternatives = new Map([['jszip', 'MIT']]);
const packages = Object.entries(lock.packages ?? {})
  .filter(([name]) => name.startsWith('node_modules/'))
  .map(([location, value]) => {
    const name = location.replace(/^node_modules\//, '');
    return {
      name,
      version: value.version ?? 'unknown',
      license: value.license ?? licenseOverrides.get(name) ?? 'UNKNOWN',
      selectedLicense: selectedAlternatives.get(name) ?? null,
    };
  })
  .sort((left, right) => left.name.localeCompare(right.name));

const unresolved = packages.filter((item) => item.license === 'UNKNOWN');
if (unresolved.length > 0) {
  console.error(
    `License inventory has unresolved packages: ${unresolved.map((item) => item.name).join(', ')}`,
  );
  process.exit(1);
}

const reportDir = path.join(root, 'reports');
fs.mkdirSync(reportDir, { recursive: true });
fs.writeFileSync(
  path.join(reportDir, 'licenses.json'),
  `${JSON.stringify({ generatedAt: new Date().toISOString(), packages }, null, 2)}\n`,
);
console.log(`Recorded ${packages.length} package licenses.`);

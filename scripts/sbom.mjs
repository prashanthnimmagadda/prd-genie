import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const root = path.resolve(import.meta.dirname, '..');
const lockPath = path.join(root, 'package-lock.json');
const lockBytes = fs.readFileSync(lockPath);
const lock = JSON.parse(lockBytes.toString('utf8'));
const lockHash = createHash('sha256').update(lockBytes).digest('hex');
const uuid = [
  lockHash.slice(0, 8),
  lockHash.slice(8, 12),
  `4${lockHash.slice(13, 16)}`,
  `8${lockHash.slice(17, 20)}`,
  lockHash.slice(20, 32),
].join('-');

const components = Object.entries(lock.packages ?? {})
  .filter(([location, value]) => location.startsWith('node_modules/') && value.version)
  .map(([location, value]) => {
    const packageName = location.replace(/^node_modules\//, '');
    const scoped = /^@([^/]+)\/(.+)$/.exec(packageName);
    const name = scoped?.[2] ?? packageName;
    const group = scoped?.[1] ? `@${scoped[1]}` : undefined;
    const encodedName = scoped
      ? `%40${encodeURIComponent(scoped[1])}/${encodeURIComponent(name)}`
      : encodeURIComponent(name);
    return {
      type: 'library',
      'bom-ref': `pkg:npm/${encodedName}@${value.version}`,
      ...(group ? { group } : {}),
      name,
      version: value.version,
      licenses: [{ license: { name: value.license ?? 'NOASSERTION' } }],
      purl: `pkg:npm/${encodedName}@${value.version}`,
    };
  })
  .sort((left, right) => left['bom-ref'].localeCompare(right['bom-ref']));

const report = {
  bomFormat: 'CycloneDX',
  specVersion: '1.5',
  serialNumber: `urn:uuid:${uuid}`,
  version: 1,
  metadata: {
    timestamp: new Date().toISOString(),
    component: {
      type: 'application',
      name: lock.name,
      version: lock.version,
      'bom-ref': `pkg:npm/${encodeURIComponent(lock.name)}@${lock.version}`,
    },
    properties: [{ name: 'lockfile:sha256', value: lockHash }],
  },
  components,
};

const reportDir = path.join(root, 'reports');
fs.mkdirSync(reportDir, { recursive: true });
fs.writeFileSync(path.join(reportDir, 'sbom.cdx.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(`Recorded ${components.length} components in the CycloneDX SBOM.`);

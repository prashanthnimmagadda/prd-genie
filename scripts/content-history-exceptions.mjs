// Exact, reviewed findings in commits already published on the release branch.
// Each entry is bound to a full commit ID, path, finding, and Git blob ID.
// New commits and changed content cannot inherit an exception.
const landingBlob = 'ce44b5ab073ffeca93a7dfc0b61449a91ddc0651';
const exampleBlob = '43ae2b6c1dcaa1303521a39e25ea542241b9527e';
const testBlob = '889e33a52ab4e2ffd689245d50b3e6362f88420f';

const historicalCommits = [
  {
    commit: 'a687a01bb2088169287daab220d37b49c4c6a127',
    parserBlob: 'a832bb009143e674b8add7876bb9b6a9de988e67',
    landing: true,
  },
  {
    commit: '40e390622dc818f4885c8b98446951bb50033635',
    parserBlob: 'a832bb009143e674b8add7876bb9b6a9de988e67',
    landing: true,
  },
  {
    commit: '1e3a204449b8dfa25433e696db24c45057c9fbc7',
    parserBlob: '4756c6bebfd3aec384cbedeca424fc2a588ed566',
    landing: true,
  },
  {
    commit: 'f60cbc520f932cb34415b3d2a752f0cc4b557e18',
    parserBlob: '1f227b2eaa91001cf49c342929d1c5cafb6442b2',
    landing: true,
  },
  {
    commit: '296f9dfd6b8eb3c4e9a2e65d0815814e7918423a',
    parserBlob: '1f227b2eaa91001cf49c342929d1c5cafb6442b2',
    landing: true,
  },
  {
    commit: 'bdc0f2eab9714f591ea28a1cce4f478d50182c60',
    parserBlob: '1f227b2eaa91001cf49c342929d1c5cafb6442b2',
    landing: true,
  },
  {
    commit: '540241562c6a524e2c174be648b7233d77af1202',
    parserBlob: '1f227b2eaa91001cf49c342929d1c5cafb6442b2',
    landing: false,
  },
];

const exceptions = new Map();
for (const { commit, parserBlob, landing } of historicalCommits) {
  const add = (relative, finding, blob) => {
    exceptions.set(JSON.stringify([commit, relative, finding]), blob);
  };
  if (landing) add('landing/index.html', 'long dash character', landingBlob);
  add('src/client/example-project.ts', 'long dash character', exampleBlob);
  add('src/server/documents/parser.ts', 'reserved product term', parserBlob);
  add('tests/unit/chatgpt-service.test.ts', 'possible secret', testBlob);
}

export function historicalExceptionBlob(commit, relative, finding) {
  return exceptions.get(JSON.stringify([commit, relative, finding]));
}

export function matchesHistoricalException(commit, relative, finding, actualBlob) {
  const expectedBlob = historicalExceptionBlob(commit, relative, finding);
  return expectedBlob !== undefined && actualBlob === expectedBlob;
}

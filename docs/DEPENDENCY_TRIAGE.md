# Production dependency triage - 22 October 2026

This review covers the local macOS app's installed production dependencies. The
app bundle copies those dependencies from `node_modules`; it does not copy the
development-only tree.

The initial npm audit reported 16 production package findings: 9 high and 7
moderate. The focused updates move Fastify to 5.12.7, Transformers to 4.3.1,
Mammoth to 1.12.3, and the existing overrides for `adm-zip`, `brace-expansion`,
`fast-uri`, and `sharp` to patched versions. The Mammoth patch addresses the
upstream [crafted-DOCX parsing denial of service](https://github.com/mwilliamson/mammoth.js/blob/master/NEWS).

The remaining production findings were one dependency chain:
`mammoth → argparse → sprintf-js`. PRD Genie calls Mammoth's `convertToHtml`
library API for DOCX input; `argparse` is imported by Mammoth's CLI. The
[sprintf-js advisory](https://github.com/advisories/GHSA-hp3w-g68c-fv3c)
lists no patched version. The existing `argparse` 1.x dependency is overridden
to 2.0.1, which has no `sprintf-js` dependency. Both Mammoth's library parser
tests and a real DOCX conversion through its CLI passed with this override.
The CLI emits deprecation warnings for its older API, but its conversion works.

The full installed tree reported 3 critical, 11 high, and 9 moderate findings
before development-tool updates. The unused `shadcn` CLI was removed from the
development tree; its MIT-licensed CSS remains in the project with its license
notice and is copied into the macOS bundle. Build and test tools were updated,
along with narrow overrides for their vulnerable transitive packages. The
resulting **full `npm audit` and production-only audit each report zero package
findings** on 22 October 2026. This is an advisory database result, not proof
that all dependencies are free of vulnerabilities.

The package tree was reinstalled from the lockfile, the updated local embedding
runtime produced a 384-dimensional vector for synthetic text, and the built
macOS bundle started its isolated local server. Parser, API, retrieval, export,
and browser workflow checks passed. ZIP metadata can understate the size or
entry count of uploaded Office files, so the shared parser now checks the
entries JSZip actually loads and counts their bytes during inflation before
handing a DOCX to Mammoth or parsing slides and sheets.

These results support private local validation. Signing, notarization, live
ChatGPT consent, the user's private Recall document, and public distribution
have separate validation or approval requirements.

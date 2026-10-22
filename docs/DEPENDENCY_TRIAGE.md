# Production dependency triage - 22 October 2026

This review covers the local macOS app's installed production dependencies. The
app bundle copies those dependencies from `node_modules`; it does not copy the
development-only tree.

The initial npm audit reported 16 production package findings: 9 high and 7
moderate. The focused updates move Fastify to 5.12.7, Transformers to 4.3.1,
Mammoth to 1.12.3, and the existing overrides for `adm-zip`, `brace-expansion`,
`fast-uri`, and `sharp` to patched versions. The Mammoth patch addresses the
upstream [crafted-DOCX parsing denial of service](https://github.com/mwilliamson/mammoth.js/blob/master/NEWS).

The resulting `npm audit --omit=dev` reports **0 critical, 0 high, and 3
moderate package findings**. All three are one dependency chain:
`mammoth → argparse → sprintf-js`. PRD Genie calls Mammoth's `convertToHtml`
library API for DOCX input; `argparse` is imported by Mammoth's CLI, which the
app does not invoke. The [sprintf-js advisory](https://github.com/advisories/GHSA-hp3w-g68c-fv3c)
requires control of a format string and lists no patched version. npm suggests
downgrading Mammoth to 0.3.29; that would replace the current parser with an
older incompatible version, so it was not applied. The package finding remains
visible rather than being suppressed.

The full installed tree still reports 3 critical, 11 high, and 9 moderate
package findings in the latest audit. Its high and critical findings are outside
the app's production dependency set. They remain relevant to development and
build-tool maintenance; this production-focused remediation does not claim to
clear the full audit.

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

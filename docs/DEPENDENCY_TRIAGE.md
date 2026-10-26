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

These dependency results support local validation. Signing, notarization,
private real-document validation, and public distribution remain separate steps.

## Follow-up - 25 October 2026

A current audit at `a8f4d16` found one high and one moderate production finding;
the full tree had one high and three moderate findings. These supersede the
earlier zero-finding snapshot. The affected packages were Undici 8.10.2, its
7.29.1 copy inside the AI SDK, and fast-uri 4.1.5 inside Fastify dependencies.

The compatible updates are Undici 8.12.2, a major-specific override retaining
Undici 7.30.1 for its existing SDK consumer, and fast-uri 4.2.3. The already
patched fast-uri 3.1.9 branch remains unchanged. No provider, model, prompt or
grounding rule changes are included.

The application's guarded custom-provider fetch reaches Undici's response
decoder, making the upstream excessive-content-encoding crash relevant. The
patched application guarded fetch and the SDK's Undici copy rejected a disposable malformed
loopback response and still decoded an ordinary compressed response. Encoded
scheme alternatives were rejected by fast-uri while a normal URL was preserved.
The existing 47 provider/API checks and TypeScript checks passed, and the full
online audit reported zero findings after the update.

No application use of Undici EventSource or integrity options was found. The
SDK asset-download path and user-controlled Fastify schema resolution were not
established as reachable in current product workflows. Updating those copies
removes the reported dependency exposure without claiming an exploit occurred.
Final release reports must still identify the exact clean candidate commit.

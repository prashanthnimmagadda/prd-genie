# macOS release package

The public asset inventory permits one Apple Silicon ARM64 ZIP in addition to
its six source and evidence files. Its name is
`prd-genie-v<VERSION>-macos-arm64.zip`, where VERSION is the exact package version,
including any prerelease suffix. Intel, universal, DMG and installer packages are
outside this amendment.

## Required evidence

All existing release gates remain mandatory for the same clean commit: offline
CI, Node 22 and 24, browser, accessibility, current dependency audit, model
evaluation and container smoke evidence. Rights attestation, content/history
checks and both preparation and publication approvals remain unchanged. A local
unsigned app does not count as a distributable package.

For a macOS release, provenance additionally inventories:

- `dist/mac/PRD Genie.app`, recursively, including nested native code and notices.
- `dist/mac/prd-genie-v<VERSION>-macos-arm64.zip`, the final distribution bytes.
- `reports/macos-release.json`, the observed package and installation record.
- `reports/macos-notarization.json`, the accepted Apple notarytool job log.
- `reports/macos-verification.txt`, the verification and installation transcript.

The verifier compares the packaged client, server, migrations and package metadata
with the validated checkout outputs. Info.plist must carry the exact commit,
package version, numeric application version, Git-derived build number and bundle
identifier. Every native binary must be thin ARM64. The packager omits unused
foreign dependency prebuild binaries while retaining sources and licence files.

## Prepare the final bytes

Use an independently authorised Developer ID Application identity and existing
notarisation credentials. This policy does not grant credential access, create
credentials or authorise Apple submissions. Once those actions are authorised:

1. Build and package the exact clean commit using the existing tools. Sign nested
   native code and then the app, with the same Developer ID team, hardened runtime,
   appropriate entitlements and secure timestamps. Do not use deep signing as a
   substitute for signing each nested component.
2. Archive and submit the signed app to Apple's notary service. Save the actual
   accepted job log, including job ID, submitted SHA-256 and code tickets.
3. Staple the ticket to the app and validate it. ZIP files cannot be stapled;
   rebuild the final ZIP from the stapled app using Apple's documented ditto
   archive procedure. The submitted archive and final stapled archive may have
   different digests. Never identify the earlier submission as the final download.
4. Record the final ZIP SHA-256 and complete bundle/native-code inventories. The
   verifier safely extracts that ZIP, compares every bundle file, verifies each
   native signature against the accepted ticket CDHashes and ARM64 architecture,
   validates the staple and runs Gatekeeper assessment. Only valid AppleDouble
   sidecars corresponding to app entries may accompany the bundle.
5. Install from that exact final ZIP and record observed launch and offline
   edit/save/reopen/export behaviour without security bypasses. Record the machine's
   macOS version, reviewer and timestamp. Do not mark unobserved checks as passed.

Apple documents [stapling the app and repackaging the ZIP](https://developer.apple.com/documentation/security/customizing-the-notarization-workflow)
and [distribution signing and notarisation](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution).

## Package report contract

`reports/macos-release.json` uses these fields; values must describe the actual
package and observations, not examples copied into a passing report:

| Field                                               | Required value                                                                                              |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `schemaVersion`, `passed`                           | `1`, `true`                                                                                                 |
| `git`                                               | Exact `sha` and `clean: true`                                                                               |
| `architecture`                                      | `arm64`                                                                                                     |
| `version`, `build`                                  | Exact package version and Git-derived build number as strings                                               |
| `bundleIdentifier`                                  | `app.stillform.prdgenie`                                                                                    |
| `archive`                                           | `{path, sha256}` for the final ZIP under `dist/mac/`                                                        |
| `components`                                        | Globally path-sorted `{path, sha256}` array for every bundle file                                           |
| `nativeCode`                                        | Same records, restricted to all detected Mach-O files                                                       |
| `teamIdentifier`, `signingName`, `signingAuthority` | Actual team, identity name and complete Developer ID Application authority                                  |
| `notarization`                                      | `id` matching Apple's `jobId`, and `logSha256` for the saved accepted log                                   |
| `verificationLogSha256`                             | SHA-256 of the nonempty verification transcript                                                             |
| `installation`                                      | Final `archiveSha256`, `architecture`, `version`, `build`, `macOSVersion`, ISO `verifiedAt`, and `reviewer` |
| `checks`                                            | Exactly the checks below, each observed and `true`                                                          |

Required checks: `developerIdApplication`, `nestedSignatures`, `hardenedRuntime`,
`secureTimestamps`, `strictSignatureVerification`, `notarizationAccepted`,
`stapleValidated`, `gatekeeperAccepted`, `finalArchiveMatchesBundle`,
`installedFromFinalArchive`, `launchSucceeded`, `offlineEditSaveReopenExport`,
`noSecurityBypass`.

The verifier repeats cryptographic, archive and platform checks; it does not
pretend to automate the installation review. The transcript and reviewer record
are required evidence for those observations. The verifier never signs, submits,
staples, launches the app or accesses credentials.

## Approval and publication

Generate local provenance only after all required evidence exists. The existing
preparation approval must bind the full artifact inventory including macOS
files. Public provenance must match that approved inventory. Add the identical
final ZIP to the release directory and checksum manifest, then request the
existing separate final promotion approval for all seven files. The final
verifier compares those bytes with the prepared artifact and revalidates evidence.

No merge, remote tag, upload or publication is authorised by this policy change.
Owner private-document validation and any recorded unresolved release gates remain
required. A passing policy unit test is not signing, notarisation or installation
evidence.

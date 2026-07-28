# Privacy

## Local data

Projects, extracted text, PRD revisions, AI run metadata, citations, and review findings are stored locally in SQLite. Original source files are stored locally by content hash.

This data is not independently encrypted. Confidentiality at rest depends on operating-system account controls, full-disk encryption, backups, and physical device security.

## Provider data

An AI action may send the following to the provider selected by the user:

- The action instruction.
- The selected PRD text.
- Retrieved source excerpts.
- Structural section IDs used to bind a response to a revision.

The application does not send the whole project unless the user explicitly chooses document scope and the context fits the provider request.

Provider handling, retention, and training policies are controlled by that provider and the user’s account agreement.

## Credentials

Session credentials are held in server memory. They are not persisted in:

- SQLite.
- Browser storage.
- URLs.
- Application logs.
- Analytics.
- Exports.
- Error payloads.

Environment variables can provide fallback credentials. Protect the process environment and terminal history.

## Telemetry

The application ships with no telemetry, advertising, tracking pixels, third-party scripts, or remote fonts.

## Deletion

Deleting a source removes its extracted locations, chunks, vectors, and local binary when no other project references the same content hash. Deleting a project removes its database records and unreferenced local binaries.

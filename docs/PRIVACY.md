# Privacy

## Local data

Projects, extracted text, PRD revisions, AI run metadata and output, durable citation snapshots, review findings, and ChatGPT handoff requests and responses are stored locally in SQLite. Original source files are stored locally by content hash.

This data is not independently encrypted. Confidentiality at rest depends on operating-system account controls, full-disk encryption, backups, and physical device security.

## Provider data

An AI action may send the following to the provider selected by the user:

- The action instruction.
- The selected PRD text.
- Retrieved source excerpts.
- Structural section IDs used to bind a response to a revision.

The application does not send the whole project unless the user explicitly chooses document scope and the context fits the provider request.

Provider handling, retention, and training policies are controlled by that provider and the user’s account agreement.

## ChatGPT handoff data

Creating a ChatGPT handoff writes the user-selected PRD sections, instruction, and evidence excerpts to a local handoff record and downloadable JSON file. Sending that file to ChatGPT is an intentional disclosure by the user to OpenAI and is outside the standalone provider request path.

An imported ChatGPT response is retained locally with its request until the handoff is dismissed or the project is deleted. The standalone application does not receive ChatGPT cookies, identity tokens, subscription details, billing data, or unrelated conversation history.

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

Deleting a source removes its extracted locations, chunks, vectors, and local binary when no other project references the same content hash. Historical citations keep their exact excerpt, source name, and locator, marked unavailable. Deleting a project removes its database records, handoff records, and unreferenced local binaries.

# Contributing

This project is currently private while rights and public naming are reviewed.

## Development

1. Use Node.js 22 or 24.
2. Run `npm ci`.
3. Create a focused branch.
4. Add synthetic tests for behavior changes.
5. Run `npm run check`.
6. Describe privacy, migration, and compatibility effects in the pull request.

Use Conventional Commit messages such as `feat: add citation locator` or `fix: preserve section order`.

## Project rules

- Never add employer, client, or production data.
- Never add credentials or real provider responses.
- Keep AI changes explicit, revision-bound, and undoable.
- Keep remote deployment and multi-user behavior outside v1.
- Preserve lexical retrieval when embeddings are unavailable.
- Use accessible names, visible focus, keyboard operation, and reduced-motion support.
- Add only dependencies with clear provenance and compatible licenses.

## Tests

Use synthetic PRDs and sources. New behavior needs the smallest suitable unit test plus integration coverage when it crosses persistence, provider, or streaming boundaries.

## Pull requests

Keep pull requests reviewable. Explain the user problem, implementation boundary, verification evidence, risks, and rollback.

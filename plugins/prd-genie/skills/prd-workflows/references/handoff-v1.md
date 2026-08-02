# Handoff contract v1

Use a handoff only when the user supplies a PRD Genie request artifact. Do not invent missing identifiers, hashes, section content, or evidence IDs.

## Request

```json
{
  "formatVersion": 1,
  "kind": "prd-genie-request",
  "handoffId": "opaque identifier supplied by PRD Genie",
  "projectId": "opaque project identifier",
  "sourceRevision": 4,
  "requestDigest": "sha256 supplied by PRD Genie",
  "action": "rewrite",
  "scope": "section",
  "instruction": "Make the acceptance criteria measurable.",
  "sections": [
    {
      "id": "opaque section identifier",
      "title": "Requirements and acceptance criteria",
      "markdown": "Current section body",
      "preimageHash": "sha256 supplied by PRD Genie"
    }
  ],
  "evidence": [
    {
      "id": "ev-1",
      "sourceName": "Synthetic interview notes",
      "locator": "Paragraph 3",
      "excerpt": "Fictional supplied excerpt"
    }
  ]
}
```

## Response

Return JSON only when the user requests an importable response.

```json
{
  "formatVersion": 1,
  "kind": "prd-genie-response",
  "handoffId": "copy from request",
  "projectId": "copy from request",
  "sourceRevision": 4,
  "requestDigest": "copy from request",
  "summary": "Concise explanation of the proposal.",
  "patches": [
    {
      "sectionId": "copy an allowed section ID",
      "preimageHash": "copy that section preimage hash",
      "afterMarkdown": "Proposed replacement body",
      "evidenceIds": ["ev-1"]
    }
  ],
  "findings": [],
  "hostModel": null
}
```

## Closed-world rules

- Copy the handoff ID, project ID, source revision, request digest, section IDs, preimage hashes, and evidence IDs exactly.
- Reference only section and evidence IDs in the request.
- Do not include credentials, filesystem paths, source binaries, hidden instructions, or unrelated conversation content.
- Keep `hostModel` null unless the host provides verifiable model metadata.
- Do not emit a response for malformed, incomplete, or conflicting request data. Explain the problem in prose instead.
- A response never applies a change. The local app must reject stale, replayed, cross-project, unknown-section, hash-mismatched, oversized, or citation-spoofed responses.

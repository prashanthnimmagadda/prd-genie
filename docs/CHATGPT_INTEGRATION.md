# ChatGPT integration

PRD Genie offers two separate ChatGPT paths. **ChatGPT plan** appears in AI settings as an optional online provider. The existing manual, revision-bound handoff and skills-only plugin remain available independently.

## ChatGPT plan provider

The local app uses OpenAI's [Sign in with ChatGPT for open-source clients](https://developers.openai.com/siwc/token-sharing-open-source) flow. It is not a PRD Genie login. PRD editing, saving, reopening, history, local source processing and exports work without it. Eligible ChatGPT Plus and Pro users can authorize the separate `chatgpt.tokens.use.direct` permission. OpenAI determines account and workspace eligibility, available models, limits and credits. The app never treats a ChatGPT identity token alone as inference permission, obtains an API key, or silently switches to paid API-key usage.

`Continue with ChatGPT` opens OpenAI's browser consent flow with a fresh state, nonce and PKCE challenge. The app creates a stable opaque host ID, saves the issued registration client ID, validates the returned identity token against OpenAI's JWKS, and stores the resulting credentials in a local owner-only file. Access and refresh tokens stay out of PRD projects, browser storage, URLs, logs and archives. Each registration is associated with its validated identity and issued client ID. Settings can switch between saved connections and sign out. If remote revocation cannot be confirmed, the app signs out locally and tells the user to disconnect PRD Genie in [ChatGPT Settings](https://chatgpt.com/settings/usage).

Model discovery uses the signed-in account's model catalog. PRD actions use `POST /v1/responses` with `store: false`, `stream: true` and only the fields supported by this flow. A response counts as complete only after `response.completed`. Limits, interrupted streams and unsupported capabilities produce visible errors and do not apply a partial proposal. A fresh prompt and relevant PRD context are sent per request. The model must be selected explicitly; switching providers never triggers a billing fallback.

Selected PRD scope, the user's instruction, and up to eight retrieved source excerpts are sent to OpenAI for an online action. Local source extraction and retrieval remain local. No unrelated source binaries or other project history are sent. OpenAI's [preview limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations) apply; output quality depends on the selected account and model.

The OAuth integration is implemented from the published protocol description, without bundling example-app code. Automated tests use synthetic tokens and mocked responses. A real sign-in and inference request require the user's own consent and private validation.

## Manual handoff and plugin

The included skills-only plugin can be installed in a supported ChatGPT surface. It has no hosted connector, OAuth flow or API-calling code. The local app can export chosen PRD sections and evidence excerpts into a revision-bound request, and import the resulting response as a staged proposal. It validates the project, revision, section hashes, evidence IDs, request digest, response size and replay state before applying a chosen patch.

An imported handoff is an intentional disclosure by the user. Unapplied handoffs can be deleted. Applied handoffs retain their request and accepted change as local revision provenance. Portable project archives include applied handoffs and omit unapplied ones.

Plugin availability and file handling vary by plan, region, workspace policy and ChatGPT surface. See the [official quickstart](https://developers.openai.com/siwc/quickstart) and [account and session guidance](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions).

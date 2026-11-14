---
id: module-pi-model-fallback
type: module-design
status: draft
title: Portable pi model fallback policy
parent: module-pi-extensions
tags: [pi-extension, model-routing]
---

## Responsibility

Classify provider quota and transient service failures and select the next configured physical model through pi's `model_fallback` extension hook. The package owns no configuration storage and imports no ThinkRail modules. It is a private portable library shared by ThinkRail and pi extension consumers; it is not published while it depends on the ThinkRail SDK patch.

## Boundary

- **Public surface:** `createModelFallbackExtension` plus pure policy and error-classification helpers from `./core`.
- **Allowed dependencies:** the public pi extension API; `node:` builtins and standard ESM only.
- **Behavior:** only OpenCode Go and OpenAI Codex selections route to configured fallbacks. Quota exhaustion switches immediately; transient service errors switch only after pi's configured retries. Authentication, invalid-request, context-overflow and aborted errors never switch. Each user turn snapshots policy at its first user message; the SDK supplies models already tried in that turn. The policy skips unavailable or unauthenticated models with an explanation and leaves pi to report the final error when the list is exhausted.
- **Portability:** requires a pi build that exposes the typed `model_fallback` hook; unpatched pi 1.5.2 cannot use this package's runtime adapter.

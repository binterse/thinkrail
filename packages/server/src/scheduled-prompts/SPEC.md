---
id: submodule-server-scheduled-prompts
type: submodule-design
status: active
title: scheduled-prompts — durable local prompt scheduling
parent: module-server
---

## Responsibility

Owns durable one-shot prompt schedules and their delivery to the existing session follow-up path.
The host starts and stops the scheduler; the host protocol exposes CRUD and scheduled-change events.
This module may use persistence paths and the public agent session API, but never owns a model loop.

## Boundary

The index.ts barrel exposes schedule create, list, update, cancel and send-now operations,
due-time validation, and host start/stop hooks. Allowed dependencies are contracts and the
agent, persistence and workspaces sibling barrels. No browser or alternate agent runtime is owned here.

Times are absolute instants. Due prompts are serialized per session and accepted into Pi's follow-up
lane in due-time then creation order. A delivery whose result is uncertain is retained as failed for
manual resolution and is never retried automatically.

The explicit sendNow operation moves a scheduled item to due immediately and awaits the same
serialized follow-up delivery path, including older due items. It never steers or interrupts.
Delivery checks the current status inside the session lane to avoid duplicate handoffs.

Schedules may pin a provider/model reference and thinking level. New UI schedules snapshot the
composer pair; legacy records without a pair retain their old session-default behavior. Validate
the pair against the session runtime when saving and again at delivery. The pair accompanies
queued content and applies only when that follow-up is consumed, never to the active turn.

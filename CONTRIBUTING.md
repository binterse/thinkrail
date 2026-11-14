# Contributing to binterse’s ThinkRail fork

This is an unofficial personal fork of [JetBrains/thinkrail](https://github.com/JetBrains/thinkrail).
Fixes, features, docs, and feedback for this fork are welcome. The official project has its own
[contribution guide](https://github.com/JetBrains/thinkrail/blob/main/CONTRIBUTING.md).

By contributing, you agree that your contributions will be licensed under the
[Apache License 2.0](LICENSE), and you agree to abide by our
[Code of Conduct](CODE_OF_CONDUCT.md).

## Reporting bugs and requesting features

The fork’s GitHub Issues tracker is currently disabled. Start with the maintainer’s
[GitHub profile](https://github.com/binterse) or [LinkedIn](https://www.linkedin.com/in/wallback/).
GitHub profiles do not offer private messaging; use LinkedIn messaging where available for direct
contact. Do not post secrets or sensitive reports publicly. For bug reports, include:

- What you did, what you expected, and what actually happened
- Your OS, Bun, and Node versions
- Relevant logs or a minimal reproduction
- The fork version or commit

If the problem also occurs on an official ThinkRail build, use the
[upstream issue tracker](https://github.com/JetBrains/thinkrail/issues) and follow its reporting
guidelines. State which official build reproduced it; do not assume a fork-only problem affects upstream.

## Development setup

**Prerequisites:** [Bun](https://bun.sh) 1.4.4 (the repository's pinned package manager and runtime),
Node.js ≥ 22.23.4 (the in-process `pi` engine needs ≥ 22.19; the website build and typecheck need
≥ 22.23.4 for Astro 7.4), and an authenticated `pi` provider for agent work.

```bash
git clone https://github.com/binterse/thinkrail.git
cd thinkrail
bun install
bun run dev
```

`bun run dev` boots the host and the web client together and cleans up on `Ctrl+C`. Source/dev runs and
locally unstamped builds expose no application updater: update a checkout with Git and rebuild it.
Running `thinkrail update` from source installs a published binary; it does not pull, install
dependencies, or rebuild the checkout. On-disk app state (projects, workspaces, worktrees) lives under
`~/.thinkrail`.

To run the launchers:

```bash
bun run --filter @thinkrail/cli dev  # browser launcher
bun run build:binary                 # standalone CLI artifact
bun run desktop:dev                  # package and open the Electrobun app
bun run desktop:build                # package without opening it
```

Desktop commands use the standard Electrobun CLI/configuration. Its pre-build hook builds the shared UI
and stages ThinkRail's PI/native resources; Electrobun owns preload bundling and installer creation.
Create host-native installers with `bun run desktop:package:stable` or `bun run desktop:package:canary`;
`canary` is Electrobun's internal name for the public **nightly** channel. Native/installer smoke and shared
CLI/desktop probes live in `packages/artifact-tests`, outside the application packages. Run
`bun run smoke:desktop` after a dev build; installer smoke takes an artifact path and channel via
`bun run smoke:desktop:installer <path> <stable|canary>`. Local installer smoke is not notarization
verification: the coordinated macOS release pipeline signs Electrobun's expanded app archive and finalizes
the DMG, and that intermediate archive is not a public download.

## Repository layout

[`architecture.md`](architecture.md) lists every app and package with its role and allowed dependencies;
each module carries its own `SPEC.md`.

## Testing and linting

Run the fast gates before opening a PR (they also run as the husky pre-commit hook):

```bash
bun run lint        # biome
bun run typecheck   # tsc across all packages
bun run test        # unit tests (root tooling + each package)
```

`typecheck` runs TypeScript 7's native `tsc`. TypeScript 7 ships no `tsserver`, so an editor set to "use the
workspace TypeScript version" falls back to its bundled one; for the same checker as CI, use a TypeScript 7
language-server integration (for VS Code, the TypeScript Native Preview extension).

Every change that touches the app is verified by the end-to-end suite against the
real UI. The no-agent gate builds once and automatically uses isolated parallel
shards (half the available CPUs, capped at eight):

```bash
bunx playwright install chromium                    # one-time
bun run e2e                                         # complete no-agent gate
bun run e2e -- e2e/changes.spec.ts                  # focused iteration
bun run e2e -- --last-failed                        # repair loop
bun run e2e:serial                                  # one-host debugging fallback
bun run e2e -- --shards=12                          # explicit 1–16 override
bun run e2e:binary                                  # packaged CLI host (build first)
bun run e2e:desktop                                 # packaged desktop host (build first)
bun run e2e:full                                    # everything; needs pi auth
bun run e2e:agent                                   # only @agent; remains serial
```

Use focused or last-failed runs while iterating, then run the complete `bun run e2e`
once before handoff. On macOS, every public browser E2E command prevents idle system sleep for the
runner's lifetime while allowing the display to sleep normally. Agent-driven specs are tagged `@agent`
and run against a real provider on an **isolated** `pi` agent dir — never your real `~/.pi/agent`.

## Module boundaries

ThinkRail is built as a set of clearly bounded, fractal modules: each package is a
module, and directories inside a package are modules too. A sub-module exposes its
public surface through an `index.ts` barrel; siblings import through that barrel,
never its internals. Every module has a `SPEC.md` that states what it owns, what it
exposes, and what it must not reach into. Keep changes within these boundaries, and
cover a module's public surface with tests where practical.

## Specification-driven development

ThinkRail is developed spec-first: hierarchical, interconnected specs live in the
repo alongside the code — top-level specs at the root
([`goal-and-requirements.md`](goal-and-requirements.md),
[`architecture.md`](architecture.md)) and a co-located `SPEC.md` for every module.
**The spec leads the code:** a change that moves or blurs a boundary, contract, or
decision updates the relevant `SPEC.md` first, then the code and the tests that pin
it. See [`AGENTS.md`](AGENTS.md) for the spec workflow.

## Translations

ThinkRail's interface strings live in one file,
[`packages/locales/en.json`](packages/locales/en.json): a flat JSON object of named keys
(`"settings.language.title": "Language"`). A translation is the same file with the values translated.

1. Copy `en.json` into `~/.thinkrail/locales/` as your language's code — `de.json`, `pt-BR.json`,
   `zh-Hant.json`. Keep the keys; translate the values. Strings you leave out stay in English.
2. Keep every `{{placeholder}}` exactly as written (a string whose placeholders differ from English is
   ignored) and keep `<0>…</0>` markers around the same words. Keep literals the user must type
   verbatim too — a protocol answer such as OpenSSH's `yes`, a JSON key, a flag, or a command — even
   when the prose around them is translated.
3. Counters come in plural forms: English has `key_one` and `key_other`; write the forms your language
   uses from `_zero`, `_one`, `_two`, `_few`, `_many`, `_other`
   ([CLDR plural rules](https://www.unicode.org/cldr/charts/latest/supplemental/language_plural_rules.html)).
   Russian, for example, uses `_one` (1, 21, 31…), `_few` (2–4, 22–24…), `_many` (5–20…) and `_other`:
   `"tools.read.firstLines_one": "первая {{count}} строка"`,
   `"tools.read.firstLines_few": "первые {{count}} строки"`,
   `"tools.read.firstLines_many": "первые {{count}} строк"`. Each form may show `{{count}}` or leave it
   out; a form you skip falls back to your `_other`, so a counter never switches to English.
4. Open **Settings → Language** and pick your language. ThinkRail reloads the file every time you save,
   and the page shows a problem with the file if it can't be read.

To ship a translation built-in for everyone, open a pull request that adds it as
`packages/locales/<code>.json`, adds a `TRANSLATIONS` entry
`"<code>": new URL("../<code>.json", import.meta.url)` in `packages/locales/src/index.ts`, and adds the
language to the built-in list in the upstream `README.md` when contributing upstream. It may be partial;
`bun run test` checks it against `en.json` (keys, placeholders, markup, plural forms). Agent replies,
tool output, skills, and prompts are not part of the interface and are not translated.

## Submitting changes

1. Create a branch off this fork’s `main`, using your own fork if you need push access.
2. Make your change, keeping it focused. Match the surrounding code style and the
   conventions in `AGENTS.md`.
3. Add or update tests and specs, and run the checks above.
4. Open a [pull request](https://github.com/binterse/thinkrail/compare) against
   `binterse/thinkrail:main` with a clear description of *what* changed and *why*.

Keep personal-fork documentation and configuration in separate commits from functional fixes.
For an upstream contribution, start a branch from current `JetBrains/thinkrail:main` and cherry-pick
only the relevant functional commits. Follow upstream’s contribution guide and target
`JetBrains/thinkrail:main`; exclude this fork’s identity, contacts, ownership, and configuration changes.

Write commit messages and PR descriptions that explain the reasoning behind the
change, not just the mechanics. A maintainer will review your PR and may suggest
adjustments before merging.

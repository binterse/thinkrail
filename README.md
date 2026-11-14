# ThinkRail — binterse’s personal fork

This is an unofficial personal fork of ThinkRail, maintained by [Björn (@binterse)](https://github.com/binterse). It includes small fixes and additions for my own use and is not an official JetBrains distribution or support channel.

**Official ThinkRail:** [JetBrains/thinkrail](https://github.com/JetBrains/thinkrail) · [thinkrail.ai](https://thinkrail.ai/)

ThinkRail is an agentic IDE built around the `pi` coding agent. The original project and its contributors provide the foundation for this fork.

## What is different here

- **Windows file context actions:** open files and folders in VS Code, their default app, or Explorer, and copy absolute paths.
- **Scheduled prompts:** schedule a prompt for later while continuing to write and send other messages.
- **Optional private LAN access:** use the local build from another device on the same private network, with explicit host configuration and a scoped Windows firewall rule.

For this fork’s Windows build, launcher, profiles, backups, and LAN setup, see [LOCAL-BUILD.md](LOCAL-BUILD.md). These are local development builds; official installers do not include this fork’s changes.

## Build from source

```bash
git clone https://github.com/binterse/thinkrail.git
cd thinkrail
bun install
bun run dev
```

Development requires Bun 1.4.4 and Node.js ≥ 22.23.4. See [CONTRIBUTING.md](CONTRIBUTING.md) for prerequisites, checks, and other build commands.

For the official product’s capabilities and installation instructions, see the [upstream README](https://github.com/JetBrains/thinkrail#readme). [Official releases](https://github.com/JetBrains/thinkrail/releases) are published by upstream, separately from this fork. Update this source checkout with Git and rebuild it; official installers and update commands do not update this checkout.

## Questions and bug reports

For problems with this fork, start with [my GitHub profile](https://github.com/binterse) or [contact me on LinkedIn](https://www.linkedin.com/in/wallback/). This repository’s GitHub Issues tracker is currently disabled, and GitHub profiles do not offer private messaging. Use LinkedIn messaging where available to contact me directly.

Include the fork commit or version, your operating system, steps to reproduce, and what you expected to happen. Remove secrets and personal information from any logs you share.

If you can reproduce the problem on an official ThinkRail build, report it through [upstream’s issue tracker](https://github.com/JetBrains/thinkrail/issues), following their contribution guidelines. Clearly state which build you tested. The [official Discord](https://thinkrail.ai/discord) is the upstream community, not a support channel maintained for this fork.

## Upstream services and privacy

Application feedback, surveys, analytics, and release/update destinations remain upstream-controlled. This fork’s documentation does not redirect them to me. In-app feedback and surveys reach upstream rather than this fork’s maintainer; use the contacts above for fork-specific reports.

See the [upstream analytics and privacy documentation](https://github.com/JetBrains/thinkrail#analytics--privacy). Source/dev runs and locally unstamped builds have no application updater; the local Windows build also uses the dev channel.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Pull requests for this fork target `binterse/thinkrail`. Keep fork documentation and configuration separate from functional changes so fixes can be contributed upstream without the personal-fork changes.

Participation in this repository follows its [Code of Conduct](CODE_OF_CONDUCT.md).

## License and credit

ThinkRail originates from [JetBrains/thinkrail](https://github.com/JetBrains/thinkrail). Credit remains with the original authors and contributors, alongside contributors to this fork.

Licensed under the [Apache License 2.0](LICENSE). Existing copyright and attribution notices are preserved.

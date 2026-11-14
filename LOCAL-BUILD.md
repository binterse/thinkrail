# Local Windows build

This unofficial personal fork builds on ThinkRail and adds Windows file context actions,
scheduled prompts, and optional private LAN access. These instructions describe the local
Windows setup, not an official JetBrains distribution or support service. It builds a
dev-channel desktop app; native production updates are disabled. Bun 1.4.4 is pinned
under `.local/toolchain`, without changing the system PATH. No installer is run.

## One normal ThinkRail

Use **ThinkRail** on the Desktop or in the Start menu. Both invoke
`scripts/local/Start.ps1` with `-WindowStyle Hidden`, so normal startup requests a hidden
PowerShell console. Running the script directly remains useful for diagnostics.

Normal startup reads the ignored `.local/default-profile.json`. Its fields are absolute paths:

- `dataDirectory`: the user's canonical `.thinkrail` directory.
- `agentDirectory`: the canonical pi profile, normally `.pi/agent`.
- `desktopDirectory`: the desktop preferences directory, separate from test profiles.

It sets `THINKRAIL_DATA_DIR`, `PI_CODING_AGENT_DIR` and `THINKRAIL_DESKTOP_USER_DATA`
only for the child process. Normal startup retains the real home and AppData locations,
checks that registered project/workspace folders exist, refuses checkout `.local` and
OS Temp workspace paths, and avoids a second dev instance. It refuses to start alongside
the old installed app. These are launcher checks, not a general cross-process data lock.

The current machine uses the canonical user profiles, with its real project folders as
Default workspaces. The additional Binter branch workspace is a genuine Git worktree
under `.thinkrail/worktrees/binter-admin/tailscale-admin`, named
**tailscale-admin (separat branch)**. It is independent of the Default workspace.

The old Local and Original desktop shortcuts were archived. The old `.local/profile`
has a `retired.json` marker and cannot be started by this script. Keep only the normal
ThinkRail shortcut for daily use. The previous installed binary is retained for explicit
recovery; do not recreate a second everyday shortcut.

## Build and start

Close ThinkRail normally before rebuilding or backing up:

```powershell
./scripts/local/Backup.ps1
./scripts/local/Build.ps1
./scripts/local/Start.ps1
```

`Build.ps1` installs the pinned Bun version if absent, installs locked dependencies and
builds `apps/desktop/build/dev-win-x64/ThinkRail-dev`. Rebuilding does not create a new
profile or replace project files. `CreateShortcut.ps1` creates the normal Desktop
shortcut if absent and refuses to overwrite an existing shortcut.

## Backups and recovery

`.local/latest-backup.txt` references the latest Backup.ps1 snapshot. A complete snapshot
contains `manifest.json`, SHA-256 manifests, original installation files, canonical app
data, pi data, current desktop preferences when configured, shortcuts and uninstall
registration metadata. Every ThinkRail instance must be closed for backup or verification.
`VerifyOriginal.ps1` compares against that snapshot; refresh it before a new validation
cycle because normal use now intentionally changes canonical data.

The one-time profile consolidation has a separate snapshot referenced by
`.local/consolidation-backup.txt`. All five source-profile copies were verified before
migration. Shared transcripts were compared entry-by-entry: identical entries and strict
extensions were accepted, and the longest history was retained with the real cwd.
The restored branch history has a fresh session id so its Default-folder copy can remain
without a global identity collision. Its original workspace id and all 18 working-tree
changes were preserved. The migration and workspace-recovery reports are in that snapshot.

For recovery, close ThinkRail, take a fresh snapshot of current data, then inspect the
selected backup and restore only the intended scope. Never overwrite current user data
with an old snapshot without reviewing newer changes. Never copy a complete test profile
back over canonical data: test paths deliberately point to disposable repositories.

All profiles, credentials, logs, screenshots and machine-specific configuration under
`.local` remain ignored by Git. These scripts and this document contain no credentials.

## Disposable tests

Prepare a new, explicitly named profile; never reuse the retired daily-use trial:

```powershell
./scripts/local/PrepareProfile.ps1 -ProfilePath "$PWD/.local/qa-profile"
./scripts/local/Start.ps1 -TestProfile -ProfilePath "$PWD/.local/qa-profile"
```

Test startup also isolates home, AppData and provider-helper discovery. Preparation copies
history and provider configuration while remapping project and transcript cwd paths to
disposable repos. These are independent test fixtures, not synchronized project copies.
Do not create a daily-use shortcut for them. Real provider turns still cost tokens.

## Optional private LAN access

An ignored `.local/network.json` can select `{"host":"0.0.0.0","port":24242}`.
Without this file, normal startup keeps the existing loopback port 60570 default;
disposable `-TestProfile` startup stays on loopback with an ephemeral port. The desktop
window still uses loopback; other devices use `http://<host-LAN-IP>:24242/` on the same
private network when LAN config is enabled.

`EnableLanFirewall.ps1` requires Windows administrator approval. It creates or verifies the named
`ThinkRail-Local-LAN-24242` inbound TCP rule for this dev bundle only, scoped to Private
and LocalSubnet. It also disables the exact obsolete 60570 rule for the same executable
and broad Windows Query User rules for that executable. It does not change router settings.
The result is recorded in
`.local/lan-firewall-result.json`. To disable LAN hosting, remove `.local/network.json`
and restart. An administrator can remove the named firewall rule separately.

Browser UUID creation uses the existing randomUuid helper so LAN HTTP does not depend
on secure-context-only crypto.randomUUID. Electrobun startup warnings and provider
catalog failures are separate diagnostics; hidden startup does not resolve those warnings.

## Verification limits

Local LAN checks on this host cover HTTP, WebSocket, initial rendering, conversation
navigation, refresh and reconnect. They do not verify access from another device; test
`http://<host-LAN-IP>:24242/` from a phone or another computer on the same private network.

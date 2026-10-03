# deck

## Install on a Mac (one click)

1. Unzip the folder.
2. Double-click **Install deck.command**. If macOS says it is from an unidentified developer, right-click it, choose Open, then Open again (only the first time).
3. Wait about 10 to 20 minutes the first time. deck opens from Applications when it is done.

It installs its own copies of Node and Rust in `~/.deck-tools` and needs Apple's Command Line Tools (it will offer to install them). Your memory, settings and keys are kept between installs. **Uninstall deck.command** removes the app and asks before deleting any data.

Windows and Linux installers, and a ready-made Mac `.dmg`, come from the release workflow once the repo is on GitHub (push a tag like `v0.2.0`).

Local-first personal agent swarm with memory, a learning loop and a 3D command deck.
Codename until the product name is chosen.

- Rules: `AGENTS.md`
- Build order and next file: `BUILD_PLAN.md`
- Change log: `UPDATES.md`

```
mise install
pnpm install
pnpm check
```

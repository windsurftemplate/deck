# deck

## Install on a Mac (one click)

1. Unzip the folder.
2. Double-click **Install deck.command**. If macOS says it is from an unidentified developer, right-click it, choose Open, then Open again (only the first time).
3. Wait about 10 to 20 minutes the first time. deck opens from Applications when it is done.

It installs its own copies of Node and Rust in `~/.deck-tools` and needs Apple's Command Line Tools (it will offer to install them). Your memory, settings and keys are kept between installs. **Uninstall deck.command** removes the app and asks before deleting any data.

## Install on Windows (one click)

1. Unzip the folder.
2. Double-click **Install deck.cmd**. If Windows SmartScreen warns you, choose More info, then Run anyway.
3. It installs the Visual Studio C++ build tools and WebView2 if missing (Windows asks for permission; several GB), plus private copies of Node and Rust in `%LOCALAPPDATA%\deck-tools`. The first run takes about 20 to 40 minutes. deck opens when it is done.

**Uninstall deck.cmd** removes the app and asks before deleting any data.

## Install on Linux (one click)

1. Unzip the folder.
2. Run `./install-linux.sh` (or double-click it and choose Run in terminal). It asks for your password to install system libraries.
3. Ubuntu and Debian get a `.deb`, Fedora an `.rpm`, other distros an AppImage in `~/Applications`. deck needs a system keyring (GNOME Keyring or KWallet) to keep its encryption key.

`./uninstall-linux.sh` removes the app and asks before deleting any data.

Ready-made installers (`.dmg`, `.msi`/`.exe`, `.deb`, AppImage) can also come from the release workflow once the repo is on GitHub (push a tag like `v0.2.0`).

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

## License

MIT (see `LICENSE`). Third-party assets and their licenses are listed in `THIRD_PARTY_NOTICES.md`. To report a security problem, see `SECURITY.md`; to contribute, see `CONTRIBUTING.md`.

# 1. Getting started

deck is a desktop app that runs a small crew of AI agents for you. A Chief of Staff talks with you and hands work to four crew members (GTM, Operations, Engineering and Research). Everything they know lives in an encrypted file on your computer. Anything that leaves your machine waits for your approval.

This chapter takes you from download to your first conversation.

## What you need

| Item | Why |
|---|---|
| A Mac (Apple Silicon or Intel), Windows 10 or 11 (64-bit), or Linux (Ubuntu, Debian, Fedora, or others via AppImage) | deck is a desktop app |
| About 5 GB of free disk space for the first install | Build tools and the app itself |
| An API key from OpenAI (recommended), Anthropic (Claude) or Google (Gemini), or an OpenRouter key | The crew's thinking happens in these models |
| An internet connection | To reach the model provider |

You do not need to know how to code.

## Install on a Mac

1. Unzip `deck.zip`.
2. Open Terminal (press <kbd>Cmd</kbd> + <kbd>Space</kbd>, type Terminal, press Return).
3. Type `bash ` (with a space), drag **Install deck.command** from Finder into the Terminal window, and press Return.
4. Wait. The first install takes 10 to 20 minutes. Later installs take a few minutes.
5. deck opens from your Applications folder when it is done.

Why `bash`? macOS blocks scripts downloaded from the internet that are not signed by Apple. Running the file through `bash` skips that check. You can also unblock the whole folder once with:

```
xattr -dr com.apple.quarantine ~/Downloads/deck
```

The installer keeps its own copies of Node and Rust in `~/.deck-tools`, so nothing else on your Mac changes. It writes a log to `~/Library/Logs/deck-install.log`.

## Install on Windows

1. Right-click `deck.zip`, choose **Properties**, tick **Unblock**, click **OK**, then unzip it.
2. Double-click **Install deck.cmd**.
3. If SmartScreen warns you, choose **More info**, then **Run anyway**.
4. The first run may install Microsoft's C++ build tools (several GB). Allow it when Windows asks. Expect 20 to 40 minutes the first time.

The log is at `%LOCALAPPDATA%\deck-install.log`.

## Install on Linux

1. Unzip the folder.
2. Run `./install-linux.sh` in a terminal. It asks for your password to install system libraries.
3. Ubuntu and Debian get a `.deb`, Fedora an `.rpm`, other distributions an AppImage in `~/Applications`.

deck stores its encryption key in your system keyring (GNOME Keyring or KWallet), so one of them must be running.

## The power-up screen

Every time deck starts, it runs a short power-up check. Each segment of the ring lights up as a system checks out: power, keychain, memory, models, tracker, chat and so on.

- A segment that stays dark with a message means something needs attention. The message tells you what and how to fix it.
- **Models** stays dark until you add a model key. That is expected on first run.
- If a blocking problem is found (for example, the keychain cannot hold the memory key), deck stops and tells you why rather than risk your data.

## First-run setup

The first time you open deck, a short setup walks you through five steps.

1. **Connect an LLM.** OpenAI is selected first. Paste your API key and press **Test**. deck reads the models your key can use and picks the newest OpenAI reasoning model for heavy work and the newest mini model for quick work, then makes a tiny request to confirm it works. It re-checks weekly and moves to newer models on its own. The key goes into your system keychain, never into a file. You can choose another provider or a specific model here or later in Settings, Models.
2. **Starting setup.** Pick a pack that matches your work: Startup founder, Freelancer or consultant, Student, VaultProof, or Start blank. A pack gives the crew a few rules, skills and first issues. Packs can only make the crew more careful.
3. **About you.** A few questions: your name, role, priorities, the people you work with, and how you like answers. These become facts the crew remembers.
4. **How much to ask.** Choose an approval preset: Cautious, Balanced or Autonomous. You can change it any time. See chapter 2.
5. **Ready.** deck shows your recovery key. Write it down or store it in a password manager. It is the only way to open your memory if your keychain entry is ever lost.

## Your first conversation

Type into the chat box on the right and press **Send**. Try:

- "What do you know about me so far?"
- "Create an issue to follow up with Dana at Acme next Tuesday."
- "Research what Acme announced this month and summarize it with sources."

You will see three typing dots, then the reply streaming in word by word. If the Chief of Staff wants to do something that needs your approval, a card appears with **Approve** and **Reject** buttons.

## Updating

Download the new `deck.zip`, unzip it (a new folder is fine), and run the installer from the new folder the same way you did the first time. Your memory, settings and keys are kept. Once the new version opens, you can delete the old folder.

## Uninstalling

Run **Uninstall deck.command** (Mac), **Uninstall deck.cmd** (Windows) or `./uninstall-linux.sh` (Linux). It removes the app and asks before deleting your data. Your data is only deleted if you type `DELETE`. Chapter 10 lists where everything lives if you prefer to remove things by hand.

# 13. Labs: features you turn on

**Settings > Labs** holds features that start off. Turn on only what you want. Whatever you turn on, the locked rules still apply: anything that leaves your machine needs your approval, and outside content is treated as data.

## Complexity routing

Simple requests (thanks, quick lookups, "create an issue") go to the **cheap** model; anything that needs thinking, writing or delegation goes to the **heavy** one. The decision uses plain signals, not an extra model call, and picks heavy when unsure. Saves tokens on everyday chat.

## Local models (Ollama)

Run models on your own computer, free, with nothing leaving the machine.

1. Install Ollama from ollama.com and start it.
2. Pull a model in a terminal: `ollama pull llama3.2` (or any model you like).
3. Turn on **Local models** in Labs and press **Check connection**.
4. In Settings > Models, pick **Ollama (local, Labs)** for any role and press Load models.

Local models are slower and less capable than the large hosted ones. Good fits: the cheap role (checking, summaries) or private notes. Web research and pictures need a hosted model.

## Parallel work

The Chief of Staff can hand 2 to 4 independent tasks to the crew at once, for example researching four companies. Each task is still checked. Faster, and uses tokens faster.

## Crew votes

For judgement calls. Each crew member answers on its own without seeing the others, then each ranks the other answers. A Borda count picks the winner, and the Chief of Staff reports it with any strong dissent. Start one in **Crew chat** (choose **Vote** instead of Discussion), or the Chief of Staff can call one. Talk only; no tools run.

## Plugins (MCP servers)

Connect outside tools that speak MCP, such as a ticketing system or a CRM.

1. Turn on **Plugins**, press **Add plugin**, and enter a name and the server's MCP address (https, or http on this computer).
2. Add a token if the server needs one. It goes to the keychain.
3. **Save and connect** lists the plugin's tools.

The Chief of Staff can then use them. **Every call asks you first**, unless you tick **Trust read-only** for that plugin, in which case tools the server marks read-only run without asking. Results are wrapped and scanned as untrusted. Plugins run on their own servers with whatever access their token has, so add only ones you trust.

## Agent pull requests (GitHub)

Engineering can read one repository and propose changes.

1. Create a fine-grained GitHub token limited to that repository with **Contents** and **Pull requests** read and write.
2. Turn on **Agent pull requests**, enter `owner/name` and the token, and save.

Engineering can list and read files, and propose a change: deck creates a new branch, commits the files, and opens a pull request labelled `agent-proposal`. Opening a pull request always asks you first. deck never merges, never pushes to the default branch, and never deletes.

## Gmail and Calendar

The Chief of Staff can search and read mail, see your calendar, and save Gmail drafts. It cannot send: deck does not ask Google for permission to send.

1. In Google Cloud Console, create a project, enable the Gmail API and Google Calendar API, configure the consent screen, and create an **OAuth client** of type **Desktop app**.
2. Turn on **Gmail and Calendar** in Labs, paste the client id and client secret, and save.
3. Press **Connect Google** and finish in your browser. The sign-in comes back to a one-time page on your own computer.

Mail and calendar content is treated as untrusted. Saving a draft asks you first. **Disconnect** removes access from deck; you can also revoke it in your Google account.

## Federation (trusted crews on other computers)

Your crew can talk to crews on other computers you trust, such as a co-founder's deck.

1. Both sides turn on **Federation**, set a crew name, and save.
2. Each side enters the address others reach it at (a LAN address, or a Tailscale name) and presses **Make my invite**.
3. Swap invite codes, and each side pastes the other's under **Add a trusted crew**.
4. Ask the Chief of Staff to message the other crew, or it suggests it. Messages appear in **Crew chat > Federation**.

How it stays safe:

- No discovery: only crews you added by invite can talk to yours. Unknown senders are refused.
- Every message is encrypted and signed; old or replayed messages are dropped.
- Every message you send needs your approval, and secrets and personal data are removed first.
- When another crew asks something, you approve twice: once to let the Chief of Staff draft an answer, and again on the exact answer before it goes.

Use it on a private network. deck listens on the port you set (default 7787) only while Federation is on.

## Camera tours

A **Tour** button on the deck flies through every station, pausing at each. Press **Stop tour** to end it.

## 3D power-up screen

The start-up check as a 3D reactor that lights segment by segment and glows when models are online.

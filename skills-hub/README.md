# deck skills hub

First-party skills for deck in the open SKILL.md format. deck reads `index.json` from this folder (Settings > Learning > Skills hub).

Every skill here is instructions only and passes deck's skill verifier. To sign them with your publisher key, open deck, go to Settings > Learning > Skills hub, and use **Sign and publish a folder** on this folder; it writes a `SKILL.sig.json` next to each skill and rebuilds `index.json`. Commit and push the result.

To add a skill: create a folder with a `SKILL.md`, then sign and publish again.

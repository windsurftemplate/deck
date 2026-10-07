# Third-party notices

deck is MIT licensed (see `LICENSE`). It ships or downloads these third-party works under their own licenses:

| Work | Used for | License |
|---|---|---|
| Space Station Kit by Kenney (kenney.nl) | 3D command deck models (`apps/desktop/public/kenney`) | CC0 1.0 (public domain) |
| Chakra Petch font (via @fontsource) | App typeface | SIL Open Font License 1.1 |
| all-MiniLM-L6-v2 (Sentence Transformers, via Xenova) | Local memory search model, downloaded on first use | Apache 2.0 |
| Tree-sitter and its grammars (via @vscode/tree-sitter-wasm) | Splitting code into functions and classes for code search | MIT |
| Node.js | Bundled runtime for the agent engine | MIT and others (see nodejs.org) |
| npm and Cargo dependencies | Libraries | Their own licenses, listed in `pnpm-lock.yaml` and `Cargo.lock` |

whisper.cpp and ffmpeg are not bundled; you install them yourself if you turn on voice.

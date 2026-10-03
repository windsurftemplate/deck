# Contributing

Thanks for helping. Read `AGENTS.md` first: it has the rules, layout and commands, for people and coding agents alike.

## Quick start
```
mise install          # or install Node 22, pnpm 9 and Rust stable yourself
pnpm install
pnpm check            # lint, typecheck and tests for every package
pnpm --filter @deck/desktop tauri dev
```

## Pull requests
- One change per PR, with tests. Conventional commit titles (`feat:`, `fix:`, `docs:`).
- `pnpm check` must pass, including the memory and safety evals. A change that lowers an eval score will not merge.
- Never commit secrets, real keys or personal data; fixtures are fake. The pre-commit hook and CI run gitleaks.
- New adapters (storage, models, chat) must pass the matching contract test suite.
- Changes that loosen a locked-on safety rule will not be accepted.
- Pull requests opened by agents are labelled `agent-proposal` and are never merged without a human review.

## License
By contributing you agree your contributions are licensed under the MIT License (`LICENSE`).

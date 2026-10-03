# Security

deck handles API keys, an encrypted memory of your work, and actions taken on your behalf. Please report security problems privately.

## Reporting
- Do not open a public issue for a vulnerability.
- Use GitHub's private vulnerability reporting on this repository ("Security" tab, "Report a vulnerability").
- Include steps to reproduce, what an attacker could do, and the version or commit.

## Scope we care most about
- Any way a key or secret leaves the OS keychain, reaches a model, a log, memory or a file.
- Any way an action that leaves the machine runs without the owner's approval.
- Prompt injection that gets a tool call past the action gate, the honeytoken or the untrusted-content wrapper.
- Ways to read the encrypted workspace without the key.

## Design notes
The safety design (locked-on rules, the action gate, approvals, secret scanning, honeytokens, safety evals that assume a compromised model) is described in `AGENTS.md` and `UPDATES.md`. Safety evals run in CI; a change that lowers their score fails the build.

---
name: pr-review
description: Use to review a pull request: what changed, risks, missing tests, and a clear verdict.
---

# Pull request review

1. Read the description and the changed files.
2. Summarize the change in two sentences.
3. Check for: missing tests, unhandled errors, secrets or keys in code, breaking changes to public interfaces, and risky migrations.
4. Rate the risk low, medium or high, with the reason.
5. Give a verdict: approve, approve with comments, or request changes, and list the comments.

## Output
Summary, Risks, Comments, Verdict. Never merge.

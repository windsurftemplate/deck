# 8. Models and tools

## Model roles

deck uses models in roles, set in **Settings > Models**.

| Role | Used for | Typical choice |
|---|---|---|
| **Heavy** | The Chief of Staff and crew doing real work | A strong model, such as Claude Sonnet |
| **Cheap** | Checking work, learning, summaries, discussions | A fast, low-cost model, such as Claude Haiku |
| **Fallback** | Tried automatically when the main model fails (down, rate limited) | A model from a different provider |
| **Per agent** | One crew member's own model, chosen with the model arena | Whatever wins for that agent |

**Escalation** (on by default): when delegated work fails its check on a smaller model (an agent's own model from the arena, or a local model), deck tries once more on the strong model, telling it what was missing. Choose the strong model in Settings > Models; none means the heavy model.

**OpenAI auto-pick** is the default: heavy work uses the newest OpenAI reasoning model your key can use, and quick work the newest mini model. deck re-checks weekly and tells you in Crew chat when it moves to a newer model. **Check for newer models** checks now; picking a specific model turns auto-pick off; **Use OpenAI auto-pick** turns it back on. OpenAI reasoning models get built-in reasoning on hard work automatically.

**Load models** lists what your key can use, straight from the provider. Model names change often; pick from the list rather than typing.

## Providers

| Provider | Key looks like | Notes |
|---|---|---|
| Anthropic (Claude) | `sk-ant-...` | Web research and pictures supported |
| OpenAI | `sk-...` | Web research and pictures supported |
| Google (Gemini) | `AIza...` | Web research (Google Search grounding) and pictures supported |
| OpenRouter | `sk-or-...` | Many models through one key; no web research |
| Ollama (Labs) | no key | Models on your own computer; turn on in Settings > Labs |

deck checks a key's shape before saving, so a key pasted in the wrong field is caught.

## Daily token budget

Set in Settings > Models. When the crew reaches it, model calls stop until the next day. The Reactor core screen and the status bar show how much is used.

## Memory search model

**Local** (default) runs a small model on your computer (about 25 MB, downloaded once). Free and private. **OpenAI** uses OpenAI's embedding model. Switching rebuilds memory search automatically, documents included.

## The Tools page

Every integration in one place, each with its status and a shortcut to set it up.

| Tool | What it does | Setup |
|---|---|---|
| **Jev** | Model routing | Key and API address saved; connects once Jev's API is added |
| **Web research** | Research searches the web (25 searches a day) | Needs Claude, OpenAI or Gemini as the main model |
| **Telegram** | Chat and approve from your phone | Settings > Telegram |
| **VaultProof** | Keys and actions checked over MCP | Settings > VaultProof |
| **Voice** | Push-to-talk, spoken replies, hands-free | Settings > Voice |
| **Camera and pictures** | Snapshots and picture attachments | Settings > Camera |
| **Gmail and Calendar** | Briefings from mail and schedule | Waiting for Google sign-in |
| **Second brain imports** | Files, pages and note apps | Brain page |

**Who can use what** lists each agent's tools: allowed, asks you first, or off.

## Web research

The Research agent uses your model's own search tool (Claude web search, OpenAI web search, or Gemini Google Search). Answers come with source links. Results are treated as untrusted. Personal data such as emails, phone numbers and card numbers is removed from search questions before they leave your machine. The limit is 25 searches a day.

## Model arena

On the Tools page. Pick an agent and press **Run arena**.

1. deck takes the agent's recent finished tasks (at least 2).
2. It replays each as a practice run with each of your models. Practice runs can read memory, but anything that would change or send something is only recorded.
3. The same checker scores every run.
4. You see a score and token count per model, and a recommendation. Ties go to the model that used fewer tokens.
5. **Use it for this agent** gives that agent its own model. Others keep the main one.

The arena uses tokens. Run it when you suspect an agent would do better with a different model.

import { describe, expect, it } from "vitest";
import { makeChatModel, type ProviderId } from "./index.js";

const sse = (events: unknown[]) => new Response(events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("") + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } });
const run = async (provider: ProviderId, events: unknown[]) => {
  let sentBody: Record<string, unknown> = {};
  let url = "";
  const f = (async (u: string, init?: RequestInit) => ((url = u), (sentBody = JSON.parse(init!.body as string)), sse(events))) as unknown as typeof fetch;
  const deltas: string[] = [];
  const res = await makeChatModel({ provider, model: "m" }, async () => "k", f).chat({ maxTokens: 10, messages: [{ role: "user", content: "hi" }] }, undefined, (d) => deltas.push(d));
  return { res, deltas, sentBody, url };
};

describe("streaming replies", () => {
  it("Claude: text as it arrives, tool input assembled from pieces", async () => {
    const { res, deltas, sentBody } = await run("anthropic", [
      { type: "message_start", message: { usage: { input_tokens: 12, output_tokens: 0 } } },
      { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hel" } },
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "lo" } },
      { type: "content_block_start", index: 1, content_block: { type: "tool_use", id: "t1", name: "issues_create" } },
      { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: '{"title":' } },
      { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: '"Acme"}' } },
      { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 9 } },
    ]);
    expect(sentBody.stream).toBe(true);
    expect(deltas).toEqual(["Hel", "lo"]);
    expect(res).toMatchObject({ text: "Hello", stopReason: "tool_use", toolCalls: [{ id: "t1", name: "issues_create", input: { title: "Acme" } }], usage: { inputTokens: 12, outputTokens: 9 } });
  });

  it("OpenAI: content deltas and tool calls split across chunks", async () => {
    const { res, deltas } = await run("openai", [
      { choices: [{ delta: { content: "Hi " } }] },
      { choices: [{ delta: { content: "there" } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, id: "c1", function: { name: "issues_", arguments: '{"ti' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { name: "create", arguments: 'tle":"X"}' } }] }, finish_reason: "tool_calls" }] },
      { choices: [], usage: { prompt_tokens: 5, completion_tokens: 3 } },
    ]);
    expect(deltas).toEqual(["Hi ", "there"]);
    expect(res).toMatchObject({ text: "Hi there", toolCalls: [{ id: "c1", name: "issues_create", input: { title: "X" } }], usage: { inputTokens: 5, outputTokens: 3 } });
  });

  it("Gemini: streamGenerateContent with thought parts hidden", async () => {
    const { res, deltas, url } = await run("gemini", [{ candidates: [{ content: { parts: [{ text: "thinking", thought: true }] } }] }, { candidates: [{ content: { parts: [{ text: "Ans" }] } }] }, { candidates: [{ content: { parts: [{ text: "wer." }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 4, candidatesTokenCount: 2 } }]);
    expect(url).toMatch(/:streamGenerateContent\?alt=sse$/);
    expect(deltas).toEqual(["Ans", "wer."]);
    expect(res).toMatchObject({ text: "Answer.", stopReason: "STOP", usage: { inputTokens: 4, outputTokens: 2 } });
  });
});

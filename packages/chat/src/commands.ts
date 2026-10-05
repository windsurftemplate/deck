/** What a chat channel can ask the rest of the app to do. Shared by Telegram, Slack and Discord. */
export interface BotActions {
  brief(): Promise<string>;
  tasks(): string;
  status(): string;
  approve(id: string): string;
  /** Stops an approved action during its undo window. */
  undo(id: string): string;
  reject(id: string): string;
  kill(agent: string): string;
  /** Free text goes to the Chief of Staff (each channel has its own ongoing chat). */
  message(text: string, channel?: string): Promise<string>;
  /** Optional: confirm a settings change the crew proposed in chat. */
  apply?(id: string): Promise<string>;
  /** Optional: voice notes become text (local Whisper). */
  transcribe?(audio: Uint8Array): Promise<string>;
}

/** A button on a message: approve, reject or undo one item. */
export interface ChannelButton {
  label: string;
  verb: "approve" | "reject" | "undo";
  id: string;
}

/** Every chat channel offers the same: messages to the owner, approval cards with buttons, start and stop. */
export interface Channel {
  readonly name: string;
  start(): Promise<void> | void;
  stop(): void;
  notify(text: string, buttons?: ChannelButton[]): Promise<void>;
}

export const approvalButtons = (id: string): ChannelButton[] => [
  { label: "Approve", verb: "approve", id },
  { label: "Reject", verb: "reject", id },
];
export const approvalText = (a: { id: string; agent: string; summary: string; detail: string; review?: { risk: string; text: string } }) =>
  `${a.agent} needs you\n${a.summary}${a.review ? `\nCISO: ${a.review.risk} risk. ${a.review.text}` : ""}\n\n${a.detail.slice(0, 1200)}\n\nid ${a.id}`;

export const helpText = (prefix: "/" | "!") =>
  [`${prefix}brief  morning briefing now`, `${prefix}tasks  open tasks`, `${prefix}status  crew and systems`, `${prefix}approve <id>  ${prefix}reject <id>`, `${prefix}undo <id>  stop an approved action before it runs`, `${prefix}kill <agent|all>  emergency stop`, "Anything else goes to your Chief of Staff."].join("\n");

/** A button press from any channel. */
export function runButton(verb: string, id: string, actions: BotActions): string {
  if (!id) return "Unknown button.";
  return verb === "approve" ? actions.approve(id) : verb === "reject" ? actions.reject(id) : verb === "undo" ? actions.undo(id) : "Unknown button.";
}

/** Commands start with / (Telegram) or ! (Slack and Discord, where / is taken by the app itself). */
export async function runCommand(text: string, actions: BotActions, channel: string, prefix: "/" | "!" = "/"): Promise<string> {
  const t = text.trim();
  const [first, ...rest] = t.split(/\s+/);
  const arg = rest.join(" ");
  const isCmd = !!first && (first.startsWith("/") || first.startsWith("!"));
  const cmd = isCmd ? first!.slice(1).toLowerCase().replace(/@\w+$/, "") : "";
  if (!isCmd) return actions.message(t, channel);
  switch (cmd) {
    case "start":
    case "help":
      return helpText(prefix);
    case "brief":
      return actions.brief();
    case "tasks":
      return actions.tasks();
    case "status":
      return actions.status();
    case "approve":
      return arg ? actions.approve(arg) : `Which one? ${prefix}approve <id>`;
    case "reject":
      return arg ? actions.reject(arg) : `Which one? ${prefix}reject <id>`;
    case "apply":
      return arg && actions.apply ? actions.apply(arg) : `Which one? ${prefix}apply <id>`;
    case "undo":
      return arg ? actions.undo(arg) : `Which one? ${prefix}undo <id>`;
    case "kill":
      return actions.kill(arg || "all");
    default:
      return `Unknown command.\n${helpText(prefix)}`;
  }
}

/** Splits long text for platforms with message limits, on line breaks where possible. */
export function chunks(text: string, max: number): string[] {
  const out: string[] = [];
  let rest = text;
  while (rest.length > max) {
    let cut = rest.lastIndexOf("\n", max);
    if (cut < max / 2) cut = max;
    out.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^\n/, "");
  }
  if (rest) out.push(rest);
  return out.length ? out : [""];
}

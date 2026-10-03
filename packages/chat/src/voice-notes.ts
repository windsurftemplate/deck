import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

/**
 * Local speech-to-text with whisper.cpp. Audio never leaves the machine.
 * Needs ffmpeg and a whisper.cpp binary plus model, both set in Settings > Voice.
 */
export class WhisperCppTranscriber {
  constructor(
    private opts: { whisperBin: string; modelPath: string; ffmpegBin?: string; language?: string },
  ) {}

  async transcribe(audio: Uint8Array): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "deck-voice-"));
    try {
      const ogg = join(dir, "in.ogg"), wav = join(dir, "in.wav"), out = join(dir, "out");
      await writeFile(ogg, audio);
      await run(this.opts.ffmpegBin ?? "ffmpeg", ["-loglevel", "error", "-i", ogg, "-ar", "16000", "-ac", "1", wav], { timeout: 60_000 });
      await run(this.opts.whisperBin, ["-m", this.opts.modelPath, "-f", wav, "-l", this.opts.language ?? "auto", "-otxt", "-of", out, "-np"], { timeout: 120_000 });
      return (await readFile(`${out}.txt`, "utf8")).trim();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
}

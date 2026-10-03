import { env, pipeline, type FeatureExtractionPipeline } from "@huggingface/transformers";

/**
 * Free, private embeddings on this machine. The model downloads once (about 25 MB) into
 * the app's cache folder, then works offline. 384-dimensional unit vectors.
 */
export class LocalEmbedder {
  readonly dim = 384;
  private pipe: Promise<FeatureExtractionPipeline> | null = null;

  constructor(
    private opts: { cacheDir?: string; model?: string; allowDownload?: boolean } = {},
  ) {}

  private load(): Promise<FeatureExtractionPipeline> {
    if (!this.pipe) {
      if (this.opts.cacheDir) env.cacheDir = this.opts.cacheDir;
      env.allowRemoteModels = this.opts.allowDownload ?? true;
      // The library's overloads are too wide for the type checker; the call itself is plain.
      const make = pipeline as unknown as (task: string, model: string, opts: object) => Promise<FeatureExtractionPipeline>;
      this.pipe = make("feature-extraction", this.opts.model ?? "Xenova/all-MiniLM-L6-v2", { dtype: "fp32" });
      this.pipe.catch(() => (this.pipe = null));
    }
    return this.pipe;
  }

  /** True once the model is on disk and loaded. */
  async ready(): Promise<boolean> {
    try {
      await this.load();
      return true;
    } catch {
      return false;
    }
  }

  async embed(texts: string[]): Promise<Float32Array[]> {
    if (!texts.length) return [];
    const p = await this.load();
    const out = await p(texts, { pooling: "mean", normalize: true });
    const data = out.data as Float32Array;
    return texts.map((_, i) => data.slice(i * this.dim, (i + 1) * this.dim));
  }
}

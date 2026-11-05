import sharp from 'sharp';
import z from 'zod';

export const QWEN_MODEL_NAME = 'Qwen3-VL-Embedding-2B';
export const QWEN_DIMENSIONS = 2048;
const prefix = "<|im_start|>system\nRepresent the user's input.<|im_end|>\n<|im_start|>user\n";
const suffix = '<|im_end|>\n<|im_start|>assistant\n';
const responseSchema = z.object({
  data: z.array(z.object({ embedding: z.array(z.number()).length(QWEN_DIMENSIONS) })).length(1),
});

export const isQwenModel = (name: string) => name === QWEN_MODEL_NAME || name === `Qwen/${QWEN_MODEL_NAME}`;

export interface QwenConfig {
  url?: string;
  apiKey?: string;
  timeout: number;
}

/** Encodes both modalities in the same space using a local llama.cpp embedding server. */
export class QwenEmbeddingClient {
  constructor(private config: QwenConfig) {}

  encodeText(text: string): Promise<string> {
    return this.embed(prefix + text + suffix);
  }

  async encodeImage(imagePath: string): Promise<string> {
    const image = await sharp(imagePath)
      .rotate()
      .resize(2048, 2048, { fit: 'inside', withoutEnlargement: true, kernel: 'cubic' })
      .toColourspace('srgb')
      .jpeg({ quality: 95, chromaSubsampling: '4:2:0' })
      .toBuffer();
    return this.embed([
      {
        content: [
          { type: 'text', text: prefix },
          { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${image.toString('base64')}` } },
          { type: 'text', text: suffix },
        ],
      },
    ]);
  }

  private async embed(input: unknown): Promise<string> {
    if (!this.config.url) {
      throw new Error('Set IMMICH_QWEN_URL to the local llama.cpp server before selecting the Qwen search model');
    }

    const base = this.config.url.endsWith('/') ? this.config.url : `${this.config.url}/`;
    const response = await fetch(new URL('v1/embeddings', base), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.config.apiKey && { Authorization: `Bearer ${this.config.apiKey}` }),
      },
      body: JSON.stringify({ model: QWEN_MODEL_NAME, input, encoding_format: 'float' }),
      signal: AbortSignal.timeout(this.config.timeout),
    });
    if (!response.ok) {
      // Do not log input photos, query text, or API credentials on failure.
      throw new Error(`Qwen embedding server returned HTTP ${response.status}`);
    }

    const { data } = responseSchema.parse(await response.json());
    const vector = data[0].embedding;
    const norm = Math.hypot(...vector);
    if (!Number.isFinite(norm) || norm < 1e-8) {
      throw new Error('Qwen embedding server returned an invalid vector');
    }
    return JSON.stringify(vector.map((value) => Math.fround(value / norm)));
  }
}

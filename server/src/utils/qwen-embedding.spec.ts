import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { QWEN_DIMENSIONS, QwenEmbeddingClient } from 'src/utils/qwen-embedding.js';

const response = (embedding: number[]) => Response.json({ data: [{ embedding }] });

describe(QwenEmbeddingClient.name, () => {
  const fetchMock = vi.fn<typeof fetch>();
  const client = new QwenEmbeddingClient({ url: 'http://localhost:28083', apiKey: 'test-key', timeout: 1000 });
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(
      response(Array.from({ length: QWEN_DIMENSIONS }, (_, i) => (i === 0 ? 3 : i === 1 ? 4 : 0))),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it('preserves multilingual queries and normalizes the shared embedding space', async () => {
    const vector = JSON.parse(await client.encodeText('黃勵文 BJUT ２０２４'));
    expect(vector).toHaveLength(QWEN_DIMENSIONS);
    expect(vector[0]).toBeCloseTo(0.6);
    expect(vector[1]).toBeCloseTo(0.8);
    const [url, request] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('http://localhost:28083/v1/embeddings');
    expect(request?.headers).toMatchObject({ Authorization: 'Bearer test-key' });
    expect(JSON.parse(String(request?.body))).toMatchObject({
      model: 'Qwen3-VL-Embedding-2B',
      input:
        "<|im_start|>system\nRepresent the user's input.<|im_end|>\n<|im_start|>user\n黃勵文 BJUT ２０２４<|im_end|>\n<|im_start|>assistant\n",
    });
  });

  it('sends the whole image with orientation applied, without a square crop', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'immich-qwen-'));
    try {
      const path = join(directory, 'portrait.jpg');
      await sharp({ create: { width: 3000, height: 1500, channels: 3, background: 'white' } })
        .withMetadata({ orientation: 6 })
        .jpeg()
        .toFile(path);
      await client.encodeImage(path);
      const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
      const content = body.input[0].content;
      expect(content.map((item: { type: string }) => item.type)).toEqual(['text', 'image_url', 'text']);
      const pixels = Buffer.from(content[1].image_url.url.split(',', 2)[1], 'base64');
      expect(await sharp(pixels).metadata()).toMatchObject({ width: 1024, height: 2048, format: 'jpeg' });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it.each([{ embedding: [] }, { embedding: [1, 2] }, { embedding: Array.from({ length: QWEN_DIMENSIONS }, () => 0) }])(
    'rejects invalid embeddings',
    async ({ embedding }) => {
      fetchMock.mockResolvedValue(response(embedding));
      await expect(client.encodeText('test')).rejects.toThrow();
    },
  );

  it('propagates server failures instead of silently mixing CLIP and Qwen vectors', async () => {
    fetchMock.mockResolvedValue(new Response('private diagnostic', { status: 503 }));
    await expect(client.encodeText('private query')).rejects.toThrow('Qwen embedding server returned HTTP 503');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('requires an explicit endpoint', async () => {
    await expect(new QwenEmbeddingClient({ timeout: 1000 }).encodeText('test')).rejects.toThrow('IMMICH_QWEN_URL');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

import { Kysely } from 'kysely';
import { AssetVisibility } from 'src/enum.js';
import { AccessRepository } from 'src/repositories/access.repository.js';
import { AssetRepository } from 'src/repositories/asset.repository.js';
import { LoggingRepository } from 'src/repositories/logging.repository.js';
import { OcrRepository } from 'src/repositories/ocr.repository.js';
import { PartnerRepository } from 'src/repositories/partner.repository.js';
import { SearchRepository } from 'src/repositories/search.repository.js';
import { DB } from 'src/schema/index.js';
import { down, up } from 'src/schema/migrations/1793836800000-AddNormalizedOcrSearch.js';
import { SearchService } from 'src/services/search.service.js';
import { newMediumService } from 'test/medium.factory.js';
import { factory } from 'test/small.factory.js';
import { getKyselyDB } from 'test/utils.js';

let database: Kysely<DB>;
beforeAll(async () => {
  database = await getKyselyDB();
});
afterAll(async () => {
  await database?.destroy();
});

const setup = () =>
  newMediumService(SearchService, {
    database,
    real: [AccessRepository, AssetRepository, PartnerRepository, SearchRepository, OcrRepository],
    mock: [LoggingRepository],
  });

const box = (assetId: string, text: string, isVisible = true) => ({
  assetId,
  text,
  isVisible,
  boxScore: 0.99,
  textScore: 0.9,
  x1: 0,
  y1: 0,
  x2: 100,
  y2: 0,
  x3: 100,
  y3: 20,
  x4: 0,
  y4: 20,
});

describe('OCR search through existing client requests', () => {
  it('ranks literal matches ahead of typos and preserves legacy and structured pagination', async () => {
    const { sut, ctx } = setup();
    const { user } = await ctx.newUser();
    const auth = factory.auth({ user: { id: user.id } });
    const ocr = ctx.get(OcrRepository);
    const { asset: literal } = await ctx.newAsset({ ownerId: user.id, fileCreatedAt: new Date('2020-01-01') });
    const { asset: typo } = await ctx.newAsset({ ownerId: user.id, fileCreatedAt: new Date('2025-01-01') });
    await ocr.upsert(literal.id, [box(literal.id, '黃 勵 文\nＢＪＵＴ ２０２４')], 'old tokenized text');
    await ocr.upsert(typo.id, [box(typo.id, '黄历文 BJUT 2024')], 'old tokenized text');
    const query = '黄励文 bjut 2024';
    const first = await sut.searchMetadata(auth, { ocr: query, size: 1 });
    expect(first.assets.items.map((item) => item.id)).toEqual([literal.id]);
    expect(first.assets.nextPage).toBe('2');
    const second = await sut.searchMetadata(auth, { ocr: query, size: 1, page: 2 });
    expect(second.assets.items.map((item) => item.id)).toEqual([typo.id]);
    expect(second.assets.nextPage).toBeNull();
    const filter = { ocr: { matches: query } };
    const structured = await sut.searchMetadata(auth, { filter, size: 1 });
    expect(structured.assets.items.map((item) => item.id)).toEqual([literal.id]);
    const structuredNext = await sut.searchMetadata(auth, { filter, size: 1, cursor: structured.assets.nextCursor! });
    expect(structuredNext.assets.items.map((item) => item.id)).toEqual([typo.id]);
  });

  it.each(['黄历文', '黄文', '黄励义文', '黄文励'])('finds a character error: %s', async (text) => {
    const { sut, ctx } = setup();
    const { user } = await ctx.newUser();
    const { asset } = await ctx.newAsset({ ownerId: user.id });
    await ctx.get(OcrRepository).upsert(asset.id, [box(asset.id, text)], text);
    const result = await sut.searchMetadata(factory.auth({ user: { id: user.id } }), { ocr: '黄励文', size: 10 });
    expect(result.assets.items.map((item) => item.id)).toEqual([asset.id]);
  });

  it('requires every term and keeps SQL/regex punctuation literal', async () => {
    const { sut, ctx } = setup();
    const { user } = await ctx.newUser();
    const auth = factory.auth({ user: { id: user.id } });
    const { asset } = await ctx.newAsset({ ownerId: user.id });
    await ctx.get(OcrRepository).upsert(asset.id, [box(asset.id, 'BJUT 2024 %_ [abc]')], 'BJUT 2024');
    for (const query of ['BJUT 2024', '%_', '[abc]']) {
      const result = await sut.searchMetadata(auth, { ocr: query, size: 10 });
      expect(result.assets.items).toHaveLength(1);
    }
    for (const query of ['BJUT missing', "x' OR 1=1 --", 'xyz', ' '.repeat(3)]) {
      const result = await sut.searchMetadata(auth, { ocr: query, size: 10 });
      expect(result.assets.items).toHaveLength(0);
    }
  });

  it('respects ownership, requested visibility, locked assets and hidden OCR boxes', async () => {
    const { sut, ctx } = setup();
    const { user } = await ctx.newUser();
    const { user: stranger } = await ctx.newUser();
    const auth = factory.auth({ user: { id: user.id } });
    const ocr = ctx.get(OcrRepository);
    const { asset: own } = await ctx.newAsset({ ownerId: user.id });
    await ocr.upsert(own.id, [box(own.id, '黄励文'), box(own.id, 'secretword', false)], '黄励文 secretword');
    for (const options of [{ ownerId: stranger.id }, { ownerId: user.id, visibility: AssetVisibility.Locked }]) {
      const { asset } = await ctx.newAsset(options);
      await ocr.upsert(asset.id, [box(asset.id, '黄励文 secretword')], '黄励文 secretword');
    }
    for (const request of [{ ocr: '黄励文' }, { filter: { ocr: { matches: '黄励文' } } }]) {
      const result = await sut.searchMetadata(auth, { ...request, size: 10 });
      expect(result.assets.items.map((item) => item.id)).toEqual([own.id]);
    }
    const secret = await sut.searchMetadata(auth, { ocr: 'secretword', size: 10 });
    expect(secret.assets.items).toHaveLength(0);
    const boxes = await ocr.getByAssetId(own.id);
    await ocr.updateOcrVisibilities(own.id, [], boxes);
    const hidden = await sut.searchMetadata(auth, { ocr: '黄励文', size: 10 });
    expect(hidden.assets.items).toHaveLength(0);
    await ocr.updateOcrVisibilities(own.id, boxes, []);
    const visible = await sut.searchMetadata(auth, { ocr: '黄励文', size: 10 });
    expect(visible.assets.items).toHaveLength(1);
  });

  it('backfills from visible original boxes and can roll back without losing OCR', async () => {
    const db = await getKyselyDB();
    try {
      const { ctx } = newMediumService(SearchService, { database: db, real: [], mock: [LoggingRepository] });
      const { user } = await ctx.newUser();
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      await new OcrRepository(db).upsert(
        asset.id,
        [box(asset.id, '黃 勵 文 ２０２４'), box(asset.id, 'hidden', false)],
        'broken tokens',
      );
      await down(db);
      await up(db);
      expect(await db.selectFrom('ocr_search').selectAll().where('assetId', '=', asset.id).executeTakeFirst()).toEqual({
        assetId: asset.id,
        text: 'broken tokens',
        normalizedText: '黄励文2024',
      });
      expect(await db.selectFrom('asset_ocr').select('text').where('assetId', '=', asset.id).execute()).toHaveLength(2);
    } finally {
      await db.destroy();
    }
  });
});

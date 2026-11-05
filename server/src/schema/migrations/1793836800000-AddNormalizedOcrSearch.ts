import { Kysely, sql } from 'kysely';
import { Converter } from 'opencc-js';

export async function up(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE ocr_search ADD COLUMN "normalizedText" text NOT NULL DEFAULT ''`.execute(db);
  const simplify = Converter({ from: 't', to: 'cn' });
  let cursor: string | undefined;
  while (true) {
    const rows = await db
      .selectFrom('ocr_search')
      .select('assetId')
      .$if(cursor !== undefined, (qb) => qb.where('assetId', '>', cursor!))
      .orderBy('assetId')
      .limit(250)
      .execute();
    if (rows.length === 0) {
      break;
    }
    const boxes = await db
      .selectFrom('asset_ocr')
      .select(['assetId', 'text'])
      .where(
        'assetId',
        'in',
        rows.map((row) => row.assetId),
      )
      .where('isVisible', '=', true)
      .orderBy('y1')
      .orderBy('x1')
      .orderBy('id')
      .execute();
    const texts = new Map<string, string[]>();
    for (const box of boxes) {
      const list = texts.get(box.assetId) ?? [];
      list.push(box.text);
      texts.set(box.assetId, list);
    }
    for (const row of rows) {
      const normalizedText = simplify((texts.get(row.assetId) ?? []).join(' ').normalize('NFKC'))
        .toLowerCase()
        .replaceAll(/\s/gu, '');
      await db.updateTable('ocr_search').set({ normalizedText }).where('assetId', '=', row.assetId).execute();
    }
    cursor = rows.at(-1)!.assetId;
  }
  const indexSql = 'CREATE INDEX "idx_ocr_search_normalized_text" ON "ocr_search" USING gin ("normalizedText" gin_trgm_ops);';
  await sql.raw(indexSql).execute(db);
  await db.insertInto('migration_overrides').values({
    name: 'index_idx_ocr_search_normalized_text',
    value: { type: 'index', name: 'idx_ocr_search_normalized_text', sql: indexSql },
  }).execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.deleteFrom('migration_overrides').where('name', '=', 'index_idx_ocr_search_normalized_text').execute();
  await sql`DROP INDEX idx_ocr_search_normalized_text`.execute(db);
  await sql`ALTER TABLE ocr_search DROP COLUMN "normalizedText"`.execute(db);
}

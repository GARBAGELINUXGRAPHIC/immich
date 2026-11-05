import { type RawBuilder, type SqlBool, sql } from 'kysely';
import { Converter } from 'opencc-js';

const simplify = Converter({ from: 't', to: 'cn' });

// Keep the recognized text and its boxes unchanged; normalize only the search index.
export const normalizeOcrText = (text: string): string =>
  simplify(text.normalize('NFKC')).toLowerCase().replaceAll(/\s/gu, '');

export const ocrTerms = (query: string): string[] => [
  ...new Set(
    query
      .normalize('NFKC')
      .trim()
      .split(/\s+/u)
      .map((term) => normalizeOcrText(term))
      .filter(Boolean),
  ),
];

const escapeRegex = (text: string) => text.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
const escapeLike = (text: string) => text.replaceAll(/[\\%_]/g, String.raw`\$&`);

/** One OCR substitution, missing/extra character, or adjacent transposition, using Unicode characters. */
export const ocrTypoPattern = (term: string): string | undefined => {
  const chars = [...term];
  // Very short strings match too broadly; long strings use trigram similarity instead.
  if (chars.length < 3 || chars.length > 16) {
    return;
  }
  const patterns = new Set<string>();
  for (let i = 0; i < chars.length; i++) {
    const left = escapeRegex(chars.slice(0, i).join(''));
    const right = escapeRegex(chars.slice(i + 1).join(''));
    patterns.add(`${left}.${right}`);
    patterns.add(left + right);
    if (i >= chars.length - 1) {
      continue;
    }

    patterns.add(`${left}${escapeRegex(chars[i])}.${right}`);
    patterns.add(left + escapeRegex(chars[i + 1] + chars[i]) + escapeRegex(chars.slice(i + 2).join('')));
  }
  return `(${[...patterns].join('|')})`;
};

const textColumn = sql.ref('ocr_search.normalizedText');
const literal = (term: string) => sql<SqlBool>`${textColumn} like ${`%${escapeLike(term)}%`}`;

export const ocrMatch = (query: string): RawBuilder<SqlBool> => {
  const terms = ocrTerms(query);
  if (terms.length === 0) {
    return sql<SqlBool>`false`;
  }
  return sql<SqlBool>`(${sql.join(
    terms.map((term) => {
      const pattern = ocrTypoPattern(term);
      if (pattern) {
        return sql`(${literal(term)} or ${textColumn} ~ ${pattern})`;
      }
      return [...term].length > 16
        ? sql`(${literal(term)} or word_similarity(${term}, ${textColumn}) >= 0.35)`
        : literal(term);
    }),
    sql` and `,
  )})`;
};

/** Correlated score works with both legacy joins and the structured search filter API. */
export const ocrRank = (query: string): RawBuilder<number> => {
  const terms = ocrTerms(query);
  if (terms.length === 0) {
    return sql<number>`0::real`;
  }
  const allLiteral = sql.join(
    terms.map((term) => literal(term)),
    sql` and `,
  );
  const score = sql.join(
    terms.map((term) => sql`(case when ${literal(term)} then 10 else 0 end + word_similarity(${term}, ${textColumn}))`),
    sql` + `,
  );
  return sql<number>`coalesce((select (case when ${allLiteral} then 1000 else 0 end) + ${score}
    from ocr_search where ocr_search."assetId" = asset.id), 0)`;
};

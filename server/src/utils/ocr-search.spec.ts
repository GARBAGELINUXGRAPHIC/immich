import { normalizeOcrText, ocrTerms, ocrTypoPattern } from 'src/utils/ocr-search.js';

describe('OCR normalization', () => {
  it('normalizes Chinese variants, full-width characters, case, and broken lines', () => {
    expect(normalizeOcrText('黃 勵 文\nＢＪＵＴ ２０２４')).toBe('黄励文bjut2024');
    expect(ocrTerms(' 黃勵文\nBJUT BJUT ２０２４ ')).toEqual(['黄励文', 'bjut', '2024']);
  });

  it.each(['黄历文', '黄文', '黄励义文', '黄文励'])('tolerates one character error: %s', (recognized) => {
    expect(new RegExp(ocrTypoPattern('黄励文')!, 'u').test(recognized)).toBe(true);
  });

  it('keeps short queries literal and escapes regex punctuation', () => {
    expect(ocrTypoPattern('黄文')).toBeUndefined();
    expect(new RegExp(ocrTypoPattern('[abc]')!, 'u').test('[axc]')).toBe(true);
    expect(new RegExp(ocrTypoPattern('[abc]')!, 'u').test('unrelated')).toBe(false);
  });
});

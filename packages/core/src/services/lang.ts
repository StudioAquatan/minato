const CJK_RANGE = /[぀-ヿ㐀-鿿가-힯]/g;

export const detectLang = (text: string): "ja" | "en" | "und" => {
  if (!text) return "und";
  const sample = text.slice(0, 4000);
  const cjkMatches = sample.match(CJK_RANGE)?.length ?? 0;
  const letters = sample.replace(/[^\p{L}]/gu, "").length;
  if (letters === 0) return "und";
  const cjkRatio = cjkMatches / letters;
  if (cjkRatio > 0.1) return "ja";
  return "en";
};

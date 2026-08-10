export function slugify(str) {
  return (str || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

const STOPWORDS = new Set(['the', 'a', 'an', 'and', 'the band', 'jr', 'sr', 'snr']);

export function normalizeName(str) {
  return slugify(str)
    .split(' ')
    .filter((w) => !STOPWORDS.has(w))
    .join(' ');
}

/** Simple string similarity score 0..1 used to pair up acts and artist pages. */
export function nameScore(a, b) {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  if (na.startsWith(nb) || nb.startsWith(na)) {
    const shorter = Math.min(na.length, nb.length);
    if (shorter / Math.max(na.length, nb.length) >= 0.66) return 0.9;
  }
  // token overlap
  const ta = na.split(' ');
  const tb = nb.split(' ');
  const common = ta.filter((t) => tb.includes(t)).length;
  if (common === 0) return 0;
  const union = new Set([...ta, ...tb]).size;
  return Math.round((common / union) * 100) / 100;
}

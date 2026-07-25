const SCORES = {
  exactCanonical: 900,
  canonicalPrefix: 800,
  exactAlias: 700,
  aliasPrefix: 600,
  canonicalWords: 500,
  nameAliasWords: 400,
  exactCategory: 300,
  partialCategory: 200,
  substring: 100,
};

const PHRASE_BONUS = 10;

export function normalizeSearchText(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .toLowerCase()
    .replace(/\p{M}+/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function createSearchIndex(icons) {
  return icons.map((icon, catalogIndex) => {
    const name = normalizeSearchText(icon.name);
    const aliases = (icon.aliases ?? []).map(normalizeSearchText).filter(Boolean);
    const category = normalizeSearchText(icon.category);
    const nameWords = name ? name.split(' ') : [];
    const aliasWords = aliases.flatMap(alias => alias.split(' '));

    return {
      icon,
      catalogIndex,
      name,
      aliases,
      category,
      nameWords,
      nameAliasWords: [...nameWords, ...aliasWords],
      nameAliasValues: [name, ...aliases],
      searchValues: [name, ...aliases, category].filter(Boolean),
    };
  });
}

function scoreRecord(record, query, terms) {
  if (!terms.every(term => record.searchValues.some(value => value.includes(term)))) {
    return null;
  }
  if (record.name === query) return SCORES.exactCanonical;
  if (record.name.startsWith(query)) return SCORES.canonicalPrefix;
  if (record.aliases.some(alias => alias === query)) return SCORES.exactAlias;
  if (record.aliases.some(alias => alias.startsWith(query))) return SCORES.aliasPrefix;

  if (terms.every(term => record.nameWords.includes(term))) {
    return SCORES.canonicalWords + (record.name.includes(query) ? PHRASE_BONUS : 0);
  }
  if (terms.every(term => record.nameAliasWords.includes(term))) {
    const hasPhrase = record.nameAliasValues.some(value => value.includes(query));
    return SCORES.nameAliasWords + (hasPhrase ? PHRASE_BONUS : 0);
  }
  if (record.category === query) return SCORES.exactCategory;
  if (record.category.includes(query)) return SCORES.partialCategory;

  const hasPhrase = record.searchValues.some(value => value.includes(query));
  return SCORES.substring + (hasPhrase ? PHRASE_BONUS : 0);
}

export function searchIcons(searchIndex, { family = null, style = 'all', query = '' } = {}) {
  const normalizedQuery = normalizeSearchText(query);
  const terms = [...new Set(normalizedQuery.split(' ').filter(Boolean))];
  const candidates = searchIndex.filter(record => {
    if (family && record.icon.family !== family) return false;
    if (style !== 'all' && !record.icon.styles.includes(style)) return false;
    return true;
  });

  if (terms.length === 0) return candidates.map(record => record.icon);

  return candidates
    .map(record => ({ record, score: scoreRecord(record, normalizedQuery, terms) }))
    .filter(result => result.score !== null)
    .sort((a, b) => b.score - a.score || a.record.catalogIndex - b.record.catalogIndex)
    .map(result => result.record.icon);
}

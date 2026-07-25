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
    const aliasWordGroups = aliases.map(alias => alias.split(' '));
    const aliasWords = aliasWordGroups.flat();

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
      fuzzyFields: [
        { fieldRank: 0, words: nameWords },
        ...aliasWordGroups.map(words => ({ fieldRank: 1, words })),
      ],
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

function maxDistanceForTerm(term) {
  if (/^\d+$/.test(term) || term.length < 5) return 0;
  return term.length >= 10 ? 2 : 1;
}

function boundedDamerauLevenshtein(left, right, maxDistance) {
  if (left === right) return 0;

  const source = [...left];
  const target = [...right];
  if (maxDistance === 0 || Math.abs(source.length - target.length) > maxDistance) {
    return maxDistance + 1;
  }

  let previousPrevious = null;
  let previous = Array.from({ length: target.length + 1 }, (_, index) => index);

  for (let sourceIndex = 1; sourceIndex <= source.length; sourceIndex++) {
    const current = [sourceIndex];
    for (let targetIndex = 1; targetIndex <= target.length; targetIndex++) {
      const substitutionCost = source[sourceIndex - 1] === target[targetIndex - 1] ? 0 : 1;
      current[targetIndex] = Math.min(
        current[targetIndex - 1] + 1,
        previous[targetIndex] + 1,
        previous[targetIndex - 1] + substitutionCost
      );

      if (
        previousPrevious
        && sourceIndex > 1
        && targetIndex > 1
        && source[sourceIndex - 1] === target[targetIndex - 2]
        && source[sourceIndex - 2] === target[targetIndex - 1]
      ) {
        current[targetIndex] = Math.min(current[targetIndex], previousPrevious[targetIndex - 2] + 1);
      }
    }
    previousPrevious = previous;
    previous = current;
  }

  return previous[target.length] <= maxDistance ? previous[target.length] : maxDistance + 1;
}

function scoreFuzzyField(field, terms) {
  let totalDistance = 0;
  let maximumDistance = 0;
  let hasEdit = false;

  for (const term of terms) {
    const allowedDistance = maxDistanceForTerm(term);
    let bestDistance = allowedDistance + 1;

    for (const word of field.words) {
      const distance = boundedDamerauLevenshtein(term, word, allowedDistance);
      if (distance < bestDistance) bestDistance = distance;
      if (bestDistance === 0) break;
    }

    if (bestDistance > allowedDistance) return null;
    totalDistance += bestDistance;
    maximumDistance = Math.max(maximumDistance, bestDistance);
    hasEdit ||= bestDistance > 0;
  }

  return hasEdit
    ? { totalDistance, maximumDistance, fieldRank: field.fieldRank }
    : null;
}

function scoreFuzzyRecord(record, terms) {
  let best = null;

  for (const field of record.fuzzyFields) {
    const score = scoreFuzzyField(field, terms);
    if (!score) continue;
    if (
      !best
      || score.totalDistance < best.totalDistance
      || (score.totalDistance === best.totalDistance && score.maximumDistance < best.maximumDistance)
      || (
        score.totalDistance === best.totalDistance
        && score.maximumDistance === best.maximumDistance
        && score.fieldRank < best.fieldRank
      )
    ) {
      best = score;
    }
  }

  return best;
}

function rankFuzzyFallback(candidates, terms) {
  const results = candidates
    .map(record => ({ record, score: scoreFuzzyRecord(record, terms) }))
    .filter(result => result.score !== null)
    .sort((a, b) =>
      a.score.totalDistance - b.score.totalDistance
      || a.score.maximumDistance - b.score.maximumDistance
      || a.score.fieldRank - b.score.fieldRank
      || a.record.catalogIndex - b.record.catalogIndex
    );

  if (results.length === 0) return [];
  const bestTotalDistance = results[0].score.totalDistance;
  return results
    .filter(result => result.score.totalDistance === bestTotalDistance)
    .map(result => result.record.icon);
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

  const deterministicResults = candidates
    .map(record => ({ record, score: scoreRecord(record, normalizedQuery, terms) }))
    .filter(result => result.score !== null)
    .sort((a, b) => b.score - a.score || a.record.catalogIndex - b.record.catalogIndex)
    .map(result => result.record.icon);

  return deterministicResults.length > 0
    ? deterministicResults
    : rankFuzzyFallback(candidates, terms);
}

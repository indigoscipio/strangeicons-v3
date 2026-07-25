import test from 'node:test';
import assert from 'node:assert/strict';

import { createSearchIndex, normalizeSearchText, searchIcons } from '../src/scripts/search.js';

function icon(name, options = {}) {
  return {
    name,
    family: options.family ?? 'asklepios',
    styles: options.styles ?? ['regular'],
    aliases: options.aliases ?? [],
    category: options.category ?? null,
  };
}

function searchNames(icons, query, options = {}) {
  return searchIcons(createSearchIndex(icons), {
    family: options.family ?? 'asklepios',
    style: options.style ?? 'regular',
    query,
  }).map(result => result.name);
}

test('normalizes case, accents, separators, and whitespace', () => {
  assert.equal(normalizeSearchText('  Héart---ECG / Monitor  '), 'heart ecg monitor');
  assert.equal(normalizeSearchText('X-Ray'), 'x ray');
  assert.equal(normalizeSearchText('---'), '');
});

test('exact canonical matches outrank canonical prefixes and partial names', () => {
  const icons = [
    icon('portable-ecg-reader'),
    icon('ecg-monitor'),
    icon('ecg'),
  ];

  assert.deepEqual(searchNames(icons, 'ecg'), ['ecg', 'ecg-monitor', 'portable-ecg-reader']);
});

test('canonical exact matches outrank alias exact matches', () => {
  const icons = [
    icon('heart-trace', { aliases: ['ecg'] }),
    icon('ecg'),
  ];

  assert.deepEqual(searchNames(icons, 'ecg'), ['ecg', 'heart-trace']);
});

test('alias exact matches outrank alias prefixes and substrings', () => {
  const icons = [
    icon('portable-reader', { aliases: ['portable electrocardiogram reader'] }),
    icon('cardiac-reader', { aliases: ['electrocardiogram monitor'] }),
    icon('heart-trace', { aliases: ['electrocardiogram'] }),
  ];

  assert.deepEqual(searchNames(icons, 'electrocardiogram'), [
    'heart-trace',
    'cardiac-reader',
    'portable-reader',
  ]);
});

test('canonical-word matches outrank words split across names and aliases', () => {
  const icons = [
    icon('heart-device', { aliases: ['monitor'] }),
    icon('monitor-heart'),
  ];

  assert.deepEqual(searchNames(icons, 'heart monitor'), ['monitor-heart', 'heart-device']);
});

test('complete phrases outrank scattered tokens within the same tier', () => {
  const icons = [
    icon('heart-device', { aliases: ['monitor'] }),
    icon('portable-device', { aliases: ['portable heart monitor system'] }),
  ];

  assert.deepEqual(searchNames(icons, 'heart monitor'), ['portable-device', 'heart-device']);
});

test('name and alias matches outrank category-only matches', () => {
  const icons = [
    icon('medical-symbol', { category: 'cardiology' }),
    icon('heart-symbol', { aliases: ['cardiology'] }),
    icon('cardiology-monitor'),
  ];

  assert.deepEqual(searchNames(icons, 'cardiology'), [
    'cardiology-monitor',
    'heart-symbol',
    'medical-symbol',
  ]);
});

test('exact category matches outrank partial category matches', () => {
  const icons = [
    icon('urgent-symbol', { category: 'critical emergency care services' }),
    icon('emergency-symbol', { category: 'emergency-care' }),
  ];

  assert.deepEqual(searchNames(icons, 'emergency care'), ['emergency-symbol', 'urgent-symbol']);
});

test('all tokens may span canonical names, aliases, and categories', () => {
  const icons = [
    icon('monitor', { category: 'cardiology' }),
    icon('cardiology-symbol'),
  ];

  assert.deepEqual(searchNames(icons, 'cardiology monitor'), ['monitor']);
});

test('equal scores preserve original catalog order', () => {
  const icons = [
    icon('first-symbol', { aliases: ['ecg'] }),
    icon('second-symbol', { aliases: ['ecg'] }),
    icon('third-symbol', { aliases: ['ecg'] }),
  ];

  assert.deepEqual(searchNames(icons, 'ecg'), ['first-symbol', 'second-symbol', 'third-symbol']);
});

test('family and style filters apply before ranking', () => {
  const icons = [
    icon('ecg', { family: 'freud' }),
    icon('ecg-monitor', { styles: ['bold'] }),
    icon('heart-trace', { aliases: ['ecg'] }),
  ];

  assert.deepEqual(searchNames(icons, 'ecg'), ['heart-trace']);
  assert.deepEqual(searchNames(icons, 'ecg', { family: 'freud' }), ['ecg']);
  assert.deepEqual(searchNames(icons, 'ecg', { style: 'bold' }), ['ecg-monitor']);
});

test('empty queries preserve filtered catalog order', () => {
  const icons = [
    icon('second'),
    icon('first'),
    icon('excluded', { family: 'freud' }),
  ];

  assert.deepEqual(searchNames(icons, '  ---  '), ['second', 'first']);
});

test('returns no results when any query token is absent', () => {
  const icons = [icon('heart-monitor', { category: 'cardiology' })];

  assert.deepEqual(searchNames(icons, 'heart missing'), []);
});

test('fuzzy fallback handles one-edit insertions, deletions, and substitutions', () => {
  const icons = [icon('hand-pill', { aliases: ['medicine'] })];

  assert.deepEqual(searchNames(icons, 'mediciine'), ['hand-pill']);
  assert.deepEqual(searchNames(icons, 'medcine'), ['hand-pill']);
  assert.deepEqual(searchNames(icons, 'medixine'), ['hand-pill']);
});

test('fuzzy fallback treats adjacent transpositions as one edit', () => {
  const icons = [icon('heart-monitor')];

  assert.deepEqual(searchNames(icons, 'moniotr'), ['heart-monitor']);
});

test('long terms allow two edits while medium terms allow only one', () => {
  const icons = [
    icon('electrocardiogram'),
    icon('medicine'),
  ];

  assert.deepEqual(searchNames(icons, 'electrocardioxxam'), ['electrocardiogram']);
  assert.deepEqual(searchNames(icons, 'medxxine'), []);
});

test('short and numeric terms require exact matches', () => {
  const icons = [
    icon('alarm'),
    icon('dose-1234'),
  ];

  assert.deepEqual(searchNames(icons, 'alrm'), []);
  assert.deepEqual(searchNames(icons, '1235'), []);
});

test('fuzzy fallback searches aliases but not categories', () => {
  const icons = [
    icon('hand-pill', { aliases: ['medicine'] }),
    icon('medical-symbol', { category: 'cardiology' }),
  ];

  assert.deepEqual(searchNames(icons, 'medcine'), ['hand-pill']);
  assert.deepEqual(searchNames(icons, 'cardiolgy'), []);
});

test('multi-word fuzzy terms must match within one name or alias', () => {
  const icons = [
    icon('heart-device', { aliases: ['monitor'] }),
    icon('heart-monitor'),
    icon('portable-device', { aliases: ['heart monitor'] }),
  ];

  assert.deepEqual(searchNames(icons, 'heart monitro'), ['heart-monitor', 'portable-device']);
});

test('deterministic results prevent fuzzy fallback from adding guesses', () => {
  const icons = [
    icon('medicine', { aliases: ['medication'] }),
    icon('medcine-guide'),
  ];

  assert.deepEqual(searchNames(icons, 'medcine'), ['medcine-guide']);
});

test('fuzzy fallback returns only records at the best total distance', () => {
  const icons = [
    icon('electrocardioxxam'),
    icon('electrocardioxram'),
  ];

  assert.deepEqual(searchNames(icons, 'electrocardiogram'), ['electrocardioxram']);
});

test('canonical fuzzy matches outrank alias matches at equal distance', () => {
  const icons = [
    icon('pill-symbol', { aliases: ['medicine'] }),
    icon('medicine'),
  ];

  assert.deepEqual(searchNames(icons, 'medcine'), ['medicine', 'pill-symbol']);
});

test('equal fuzzy scores preserve original catalog order', () => {
  const icons = [
    icon('medline'),
    icon('medicine'),
    icon('medmine'),
  ];

  assert.deepEqual(searchNames(icons, 'medcine'), ['medline', 'medicine', 'medmine']);
});

test('family and style filters apply before fuzzy fallback', () => {
  const icons = [
    icon('medicine', { family: 'freud' }),
    icon('medicine', { styles: ['bold'] }),
    icon('hand-pill', { aliases: ['medicine'] }),
  ];

  assert.deepEqual(searchNames(icons, 'medcine'), ['hand-pill']);
  assert.deepEqual(searchNames(icons, 'medcine', { family: 'freud' }), ['medicine']);
  assert.deepEqual(searchNames(icons, 'medcine', { style: 'bold' }), ['medicine']);
});

test('short deterministic substrings do not trigger or append fuzzy results', () => {
  const icons = [
    icon('alarm'),
    icon('forearm'),
  ];

  assert.deepEqual(searchNames(icons, 'arm'), ['alarm', 'forearm']);
});

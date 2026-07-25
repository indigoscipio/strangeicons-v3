import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "fs";
import { join, basename, extname } from "path";
import library from "../data/library.json" with { type: "json" };

const ICONS_DIR     = "./public/icons";
const SPRITES_DIR   = "./public/sprites";
const OUTPUT_SRC    = "./src/icons.json";
const OUTPUT_PUBLIC = "./public/icons.json";
const METADATA_FILE = "./src/data/icon-metadata.json";
const REQUIRE_ICONS = process.argv.includes("--require-icons");
const VALID_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const VALID_ALIAS = /^[a-z0-9]+(?:[ -][a-z0-9]+)*$/;

function compareNames(a, b) {
  const lowerA = a.toLowerCase();
  const lowerB = b.toLowerCase();
  if (lowerA < lowerB) return -1;
  if (lowerA > lowerB) return 1;
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

const expectedFamilies = [...library.families].sort(compareNames);
const expectedStyles = [...library.styles].sort(compareNames);
const expectedSpriteFiles = expectedFamilies.flatMap(family =>
  expectedStyles.map(style => `${family}-${style}.svg`)
).sort(compareNames);

function assertSameList(actual, expected, label) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    const detail = expected.length <= 50
      ? `expected [${expected.join(", ")}], found [${actual.join(", ")}]`
      : `expected ${expected.length} entries, found ${actual.length}`;
    throw new Error(`${label}: ${detail}`);
  }
}

function directoryNames(path) {
  return readdirSync(path, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort(compareNames);
}

function readJson(path, label) {
  if (!existsSync(path)) throw new Error(`${label} is missing: ${path}`);
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    throw new Error(`${label} is not valid JSON: ${path}`);
  }
}

function normalizedSearchValue(value) {
  return value.replaceAll("-", " ").replace(/\s+/g, " ").trim();
}

function readIconMetadata(canonicalNames) {
  if (!Array.isArray(library.iconCategories) || library.iconCategories.length === 0) {
    throw new Error("Library icon categories must contain a non-empty array");
  }
  for (const category of library.iconCategories) {
    if (typeof category !== "string" || !VALID_NAME.test(category)) {
      throw new Error(`Library contains an invalid icon category: ${category}`);
    }
  }
  assertSameList(
    library.iconCategories,
    [...new Set(library.iconCategories)].sort(compareNames),
    "Library icon categories"
  );

  const metadata = readJson(METADATA_FILE, "Icon metadata");
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    throw new Error("Icon metadata must contain an object keyed by canonical icon name");
  }

  const names = Object.keys(metadata);
  assertSameList(names, [...names].sort(compareNames), "Icon metadata names");
  const validCategories = new Set(library.iconCategories);

  for (const name of names) {
    if (!VALID_NAME.test(name)) throw new Error(`Icon metadata contains an invalid canonical name: ${name}`);
    if (!canonicalNames.has(name)) throw new Error(`Icon metadata references an unknown canonical name: ${name}`);

    const entry = metadata[name];
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`Icon metadata entry must be an object: ${name}`);
    }
    assertSameList(Object.keys(entry).sort(compareNames), ["aliases", "category"], `Icon metadata fields for ${name}`);
    if (!Array.isArray(entry.aliases)) throw new Error(`Icon metadata aliases must be an array: ${name}`);
    if (typeof entry.category !== "string" || !validCategories.has(entry.category)) {
      throw new Error(`Icon metadata contains an invalid category for ${name}: ${entry.category}`);
    }

    for (const alias of entry.aliases) {
      if (typeof alias !== "string" || !VALID_ALIAS.test(alias)) {
        throw new Error(`Icon metadata contains an invalid alias for ${name}: ${alias}`);
      }
      if (normalizedSearchValue(alias) === normalizedSearchValue(name)) {
        throw new Error(`Icon metadata alias duplicates its canonical name: ${name} -> ${alias}`);
      }
    }
    assertSameList(entry.aliases, [...new Set(entry.aliases)].sort(compareNames), `Icon metadata aliases for ${name}`);
  }

  return metadata;
}

function applyIconMetadata(icons, metadata) {
  for (const icon of icons) {
    const entry = metadata[icon.name];
    icon.aliases = entry ? [...entry.aliases] : [];
    icon.category = entry?.category ?? null;
  }
}

function validateCatalog(icons, label, metadata) {
  if (!Array.isArray(icons) || icons.length === 0) {
    throw new Error(`${label} must contain a non-empty icon array`);
  }
  if (icons.length !== library.iconConceptCount) {
    throw new Error(`${label} contains ${icons.length} concepts; expected ${library.iconConceptCount}`);
  }

  const keys = new Set();
  const families = new Set();
  const styles = new Set();
  let variantCount = 0;

  for (const icon of icons) {
    if (!icon || typeof icon.name !== "string" || typeof icon.family !== "string" || !Array.isArray(icon.styles)) {
      throw new Error(`${label} contains an invalid icon record`);
    }

    const key = `${icon.family}::${icon.name}`;
    if (keys.has(key)) throw new Error(`${label} contains duplicate icon record: ${key}`);
    assertSameList(
      Object.keys(icon).sort(compareNames),
      ["aliases", "category", "family", "name", "styles"],
      `${label} fields for ${key}`
    );
    const expectedMetadata = metadata[icon.name];
    const expectedAliases = expectedMetadata?.aliases ?? [];
    const expectedCategory = expectedMetadata?.category ?? null;
    if (!Array.isArray(icon.aliases)) throw new Error(`${label} contains invalid aliases for ${key}`);
    assertSameList(icon.aliases, expectedAliases, `${label} aliases for ${key}`);
    if (icon.category !== expectedCategory) {
      throw new Error(`${label} category for ${key}: expected ${expectedCategory}, found ${icon.category}`);
    }
    keys.add(key);
    families.add(icon.family);

    const iconStyles = [...new Set(icon.styles)].sort(compareNames);
    assertSameList(iconStyles, expectedStyles, `${label} styles for ${key}`);
    iconStyles.forEach(style => styles.add(style));
    variantCount += iconStyles.length;
  }

  assertSameList([...families].sort(compareNames), expectedFamilies, `${label} families`);
  assertSameList([...styles].sort(compareNames), expectedStyles, `${label} styles`);
  if (variantCount !== library.iconVariantCount) {
    throw new Error(`${label} contains ${variantCount} variants; expected ${library.iconVariantCount}`);
  }
}

function validateSprites(icons) {
  if (!existsSync(SPRITES_DIR)) throw new Error(`Tracked sprite directory is missing: ${SPRITES_DIR}`);

  const spriteFiles = readdirSync(SPRITES_DIR, { withFileTypes: true })
    .filter(entry => entry.isFile() && extname(entry.name) === ".svg")
    .map(entry => entry.name)
    .sort(compareNames);
  assertSameList(spriteFiles, expectedSpriteFiles, "Tracked sprite files");

  for (const family of expectedFamilies) {
    for (const style of expectedStyles) {
      const expectedIds = icons
        .filter(icon => icon.family === family && icon.styles.includes(style))
        .map(icon => `${family}/${style}/${icon.name}`)
        .sort(compareNames);
      const sprite = readFileSync(join(SPRITES_DIR, `${family}-${style}.svg`), "utf-8");
      const symbolIds = [...sprite.matchAll(/<symbol\b[^>]*\bid="([^"]+)"/g)]
        .map(match => match[1])
        .sort(compareNames);
      assertSameList(symbolIds, expectedIds, `Sprite symbols for ${family}-${style}.svg`);
    }
  }
}

function validateTrackedFallback() {
  const sourceIndex = readJson(OUTPUT_SRC, "Source icon index");
  const publicIndex = readJson(OUTPUT_PUBLIC, "Public icon index");
  if (JSON.stringify(sourceIndex) !== JSON.stringify(publicIndex)) {
    throw new Error("Tracked source and public icon indexes do not match");
  }
  const metadata = readIconMetadata(new Set(sourceIndex.map(icon => icon?.name).filter(Boolean)));
  validateCatalog(sourceIndex, "Tracked icon index", metadata);
  validateSprites(sourceIndex);
  console.log(`✓ Validated tracked fallback: ${sourceIndex.length} concepts, ${library.iconVariantCount} variants`);
}

function buildCatalog() {
  const families = directoryNames(ICONS_DIR);
  assertSameList(families, expectedFamilies, "Raw icon families");

  const result = {};
  const sprites = new Map();
  let sourceSvgCount = 0;

  for (const family of families) {
    const familyPath = join(ICONS_DIR, family);
    const styles = directoryNames(familyPath);
    assertSameList(styles, expectedStyles, `Raw styles for ${family}`);

    for (const style of styles) {
      const stylePath = join(familyPath, style);
      const files = readdirSync(stylePath, { withFileTypes: true })
        .filter(entry => entry.isFile() && extname(entry.name) === ".svg")
        .map(entry => entry.name)
        .sort(compareNames);
      if (files.length === 0) throw new Error(`Raw style directory contains no SVGs: ${stylePath}`);

      const symbols = [];
      for (const file of files) {
        const name = basename(file, ".svg");
        const key = `${family}::${name}`;
        sourceSvgCount++;

        if (!result[key]) {
          result[key] = {
            name,
            family,
            styles: [],
          };
        }
        result[key].styles.push(style);

        const svgContent = readFileSync(join(stylePath, file), "utf-8");
        const match = svgContent.match(
          /<svg[^>]*viewBox="([^"]+)"[^>]*>([\s\S]*)<\/svg>/i
        );
        if (!match) throw new Error(`SVG cannot be converted to a sprite symbol: ${join(stylePath, file)}`);

        const [, viewBox, inner] = match;
        symbols.push(
          `<symbol id="${family}/${style}/${name}" viewBox="${viewBox}">\n${inner.trim()}\n</symbol>`
        );
      }

      const spriteFile = `${family}-${style}.svg`;
      sprites.set(spriteFile, {
        content: `<svg xmlns="http://www.w3.org/2000/svg">\n${symbols.join("\n")}\n</svg>`,
        count: symbols.length,
      });
    }
  }

  const icons = Object.values(result);
  const metadata = readIconMetadata(new Set(icons.map(icon => icon.name)));
  applyIconMetadata(icons, metadata);
  validateCatalog(icons, "Generated icon index", metadata);
  if (sourceSvgCount !== library.iconVariantCount) {
    throw new Error(`Raw corpus contains ${sourceSvgCount} SVGs; expected ${library.iconVariantCount}`);
  }
  assertSameList([...sprites.keys()].sort(compareNames), expectedSpriteFiles, "Generated sprite files");
  return { icons, sprites };
}

function writeGeneratedFiles(icons, sprites) {
  mkdirSync(SPRITES_DIR, { recursive: true });

  const existingSprites = readdirSync(SPRITES_DIR, { withFileTypes: true })
    .filter(entry => entry.isFile() && extname(entry.name) === ".svg")
    .map(entry => entry.name);
  for (const file of existingSprites) {
    if (!sprites.has(file)) unlinkSync(join(SPRITES_DIR, file));
  }

  for (const [file, sprite] of sprites) {
    writeFileSync(join(SPRITES_DIR, file), sprite.content);
    console.log(`  ✓ sprite ${file} (${sprite.count} icons)`);
  }

  const json = JSON.stringify(icons, null, 2);
  writeFileSync(OUTPUT_SRC, json);
  writeFileSync(OUTPUT_PUBLIC, json);
  console.log(`✓ Built index: ${icons.length} concepts, ${library.iconVariantCount} variants`);
}

try {
  if (!existsSync(ICONS_DIR)) {
    if (REQUIRE_ICONS) {
      throw new Error("public/icons/ is required for release generation but was not found");
    }
    validateTrackedFallback();
  } else {
    const { icons, sprites } = buildCatalog();
    writeGeneratedFiles(icons, sprites);
  }
} catch (error) {
  console.error(`✗ ${error.message}`);
  process.exit(1);
}

import { existsSync, readdirSync, readFileSync } from "fs";
import { basename, extname, join, relative } from "path";
import library from "../data/library.json" with { type: "json" };

const ICONS_DIR = "./public/icons";
const SPRITES_DIR = "./public/sprites";
const OUTPUT_SRC = "./src/icons.json";
const OUTPUT_PUBLIC = "./public/icons.json";
const METADATA_FILE = "./src/data/icon-metadata.json";
const VALID_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const VALID_ALIAS = /^[a-z0-9]+(?:[ -][a-z0-9]+)*$/;
const RENDERABLE_ELEMENT = /<(path|rect|circle|ellipse|line|polyline|polygon|use|image|text)\b/i;
const GENERATOR_SVG = /<svg[^>]*viewBox="([^"]+)"[^>]*>([\s\S]*)<\/svg>/i;
const MAX_EXAMPLES = 10;

const FAMILY_COLORS = {
  asklepios: "#2563eb",
  freud: "#926247",
  nightingale: "#14b8a6",
  osler: "#84cc16",
  sandow: "#f97316",
  turing: "#7c3aed",
};

const args = new Set(process.argv.slice(2));
const allowedArgs = new Set(["--all", "--require-icons"]);
for (const arg of args) {
  if (!allowedArgs.has(arg)) {
    console.error(`Unknown argument: ${arg}`);
    process.exit(2);
  }
}

const showAll = args.has("--all");
const requireIcons = args.has("--require-icons");
const expectedFamilies = [...library.families].sort(compareNames);
const expectedStyles = [...library.styles].sort(compareNames);
const findings = new Map();

function compareNames(a, b) {
  const lowerA = a.toLowerCase();
  const lowerB = b.toLowerCase();
  if (lowerA < lowerB) return -1;
  if (lowerA > lowerB) return 1;
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function addFinding(severity, code, label, count = 1) {
  if (!findings.has(code)) {
    findings.set(code, { severity, total: 0, groups: new Map() });
  }
  const finding = findings.get(code);
  finding.total += count;
  finding.groups.set(label, (finding.groups.get(label) || 0) + count);
}

function pathLabel(path) {
  return relative(process.cwd(), path).replaceAll("\\", "/");
}

function directoryEntries(path) {
  return readdirSync(path, { withFileTypes: true });
}

function directoryNames(path) {
  return directoryEntries(path)
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort(compareNames);
}

function sameList(actual, expected) {
  return JSON.stringify(actual) === JSON.stringify(expected);
}

function normalizedViewBox(value) {
  return value.trim().replaceAll(",", " ").replace(/\s+/g, " ");
}

function normalizedSearchValue(value) {
  return value.replaceAll("-", " ").replace(/\s+/g, " ").trim();
}

function hasBalancedTags(svg) {
  const stack = [];
  const source = svg.replace(/<!--[\s\S]*?-->/g, "");
  const tags = source.matchAll(/<\s*(\/)?([A-Za-z][\w:.-]*)\b([^>]*)>/g);

  for (const match of tags) {
    const closing = Boolean(match[1]);
    const name = match[2];
    const tail = match[3];
    if (closing) {
      if (stack.pop() !== name) return false;
    } else if (!tail.trimEnd().endsWith("/")) {
      stack.push(name);
    }
  }
  return stack.length === 0;
}

function localIds(svg) {
  return [...svg.matchAll(/\bid=["']([^"']+)["']/g)].map(match => match[1]);
}

function localReferences(svg) {
  const references = [];
  for (const match of svg.matchAll(/url\(\s*#([^)\s]+)\s*\)|(?:href|xlink:href)=["']#([^"']+)["']/g)) {
    references.push(match[1] || match[2]);
  }
  return references;
}

function readJson(path, label, missingCode = "GENERATED_FILE_MISSING", invalidCode = "GENERATED_JSON_INVALID") {
  if (!existsSync(path)) {
    addFinding("ERROR", missingCode, `${label}: ${path}`);
    return null;
  }
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    addFinding("ERROR", invalidCode, `${label}: ${path}`);
    return null;
  }
}

function canonicalNamesFromCatalog(catalog) {
  return new Set([...catalog.keys()].map(key => key.slice(key.indexOf("::") + 2)));
}

function auditIconMetadata(canonicalNames) {
  let valid = true;
  if (!Array.isArray(library.iconCategories) || library.iconCategories.length === 0) {
    addFinding("ERROR", "METADATA_CATEGORY_INVENTORY", "library iconCategories must be a non-empty array");
    valid = false;
  } else {
    for (const category of library.iconCategories) {
      if (typeof category !== "string" || !VALID_NAME.test(category)) {
        addFinding("ERROR", "METADATA_CATEGORY_INVENTORY", String(category));
        valid = false;
      }
    }
    if (!sameList(library.iconCategories, [...new Set(library.iconCategories)].sort(compareNames))) {
      addFinding("ERROR", "METADATA_CATEGORY_INVENTORY", "categories must be unique and sorted");
      valid = false;
    }
  }

  const metadata = readJson(METADATA_FILE, "icon metadata", "METADATA_FILE_MISSING", "METADATA_JSON_INVALID");
  if (!metadata) return null;
  if (typeof metadata !== "object" || Array.isArray(metadata)) {
    addFinding("ERROR", "METADATA_ROOT_INVALID", "metadata must be an object keyed by canonical icon name");
    return null;
  }

  const names = Object.keys(metadata);
  if (!sameList(names, [...names].sort(compareNames))) {
    addFinding("ERROR", "METADATA_NAME_ORDER", "canonical names must be sorted");
    valid = false;
  }
  const validCategories = new Set(Array.isArray(library.iconCategories) ? library.iconCategories : []);

  for (const name of names) {
    if (!VALID_NAME.test(name)) {
      addFinding("ERROR", "METADATA_NAME_INVALID", name);
      valid = false;
    }
    if (!canonicalNames.has(name)) {
      addFinding("ERROR", "METADATA_NAME_UNKNOWN", name);
      valid = false;
    }

    const entry = metadata[name];
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      addFinding("ERROR", "METADATA_ENTRY_INVALID", name);
      valid = false;
      continue;
    }
    if (!sameList(Object.keys(entry).sort(compareNames), ["aliases", "category"])) {
      addFinding("ERROR", "METADATA_FIELDS_INVALID", name);
      valid = false;
    }
    if (!Array.isArray(entry.aliases)) {
      addFinding("ERROR", "METADATA_ALIASES_INVALID", name);
      valid = false;
    } else {
      for (const alias of entry.aliases) {
        if (typeof alias !== "string" || !VALID_ALIAS.test(alias)) {
          addFinding("ERROR", "METADATA_ALIAS_INVALID", `${name}: ${alias}`);
          valid = false;
        } else if (normalizedSearchValue(alias) === normalizedSearchValue(name)) {
          addFinding("ERROR", "METADATA_ALIAS_CANONICAL", `${name}: ${alias}`);
          valid = false;
        }
      }
      if (!sameList(entry.aliases, [...new Set(entry.aliases)].sort(compareNames))) {
        addFinding("ERROR", "METADATA_ALIAS_ORDER", name);
        valid = false;
      }
    }
    if (typeof entry.category !== "string" || !validCategories.has(entry.category)) {
      addFinding("ERROR", "METADATA_CATEGORY_INVALID", `${name}: ${entry.category}`);
      valid = false;
    }
  }

  return valid ? metadata : null;
}

function auditGeneratedMetadata(icons, metadata) {
  if (!Array.isArray(icons)) return;

  for (const icon of icons) {
    if (!icon || typeof icon.name !== "string" || typeof icon.family !== "string") continue;
    const key = `${icon.family}::${icon.name}`;
    const expected = metadata[icon.name];
    const expectedAliases = expected?.aliases ?? [];
    const expectedCategory = expected?.category ?? null;
    if (!sameList(Object.keys(icon).sort(compareNames), ["aliases", "category", "family", "name", "styles"])) {
      addFinding("ERROR", "GENERATED_METADATA_FIELDS", key);
    }
    if (!Array.isArray(icon.aliases) || !sameList(icon.aliases, expectedAliases)) {
      addFinding("ERROR", "GENERATED_METADATA_ALIASES", key);
    }
    if (icon.category !== expectedCategory) {
      addFinding("ERROR", "GENERATED_METADATA_CATEGORY", key);
    }
  }
}

function catalogFromIndex(icons, label) {
  const catalog = new Map();
  if (!Array.isArray(icons)) return catalog;

  for (const icon of icons) {
    if (!icon || typeof icon.name !== "string" || typeof icon.family !== "string" || !Array.isArray(icon.styles)) {
      addFinding("ERROR", "GENERATED_RECORD_INVALID", label);
      continue;
    }
    const key = `${icon.family}::${icon.name}`;
    if (catalog.has(key)) addFinding("ERROR", "DUPLICATE_CONCEPT", key);
    catalog.set(key, new Set(icon.styles));
  }
  return catalog;
}

function validateCatalog(catalog, sourceLabel, reportNames = true) {
  const families = new Set();
  let variants = 0;

  for (const [key, styles] of catalog) {
    const separator = key.indexOf("::");
    const family = key.slice(0, separator);
    const name = key.slice(separator + 2);
    families.add(family);
    variants += styles.size;

    if (reportNames && !VALID_NAME.test(name)) addFinding("ERROR", "INVALID_KEBAB_CASE", name);
    const actualStyles = [...styles].sort(compareNames);
    if (!sameList(actualStyles, expectedStyles)) {
      addFinding("ERROR", "MISSING_OR_UNEXPECTED_STYLE", `${key}: ${actualStyles.join(", ")}`);
    }
  }

  if (!sameList([...families].sort(compareNames), expectedFamilies)) {
    addFinding("ERROR", "FAMILY_INVENTORY", `${sourceLabel}: ${[...families].sort(compareNames).join(", ")}`);
  }
  if (catalog.size !== library.iconConceptCount) {
    addFinding("ERROR", "CONCEPT_COUNT", `${sourceLabel}: ${catalog.size}; expected ${library.iconConceptCount}`);
  }
  if (variants !== library.iconVariantCount) {
    addFinding("ERROR", "VARIANT_COUNT", `${sourceLabel}: ${variants}; expected ${library.iconVariantCount}`);
  }
}

function compareCatalogs(actual, expected, label) {
  const actualKeys = [...actual.keys()].sort(compareNames);
  const expectedKeys = [...expected.keys()].sort(compareNames);
  if (!sameList(actualKeys, expectedKeys)) {
    addFinding("ERROR", "CATALOG_MISMATCH", `${label}: concept names differ`);
    return;
  }
  for (const key of actualKeys) {
    const actualStyles = [...actual.get(key)].sort(compareNames);
    const expectedStylesForIcon = [...expected.get(key)].sort(compareNames);
    if (!sameList(actualStyles, expectedStylesForIcon)) {
      addFinding("ERROR", "CATALOG_MISMATCH", `${label}: ${key}`);
    }
  }
}

function auditGenerated(catalog) {
  const sourceIndex = readJson(OUTPUT_SRC, "source index");
  const publicIndex = readJson(OUTPUT_PUBLIC, "public index");

  if (sourceIndex && publicIndex && JSON.stringify(sourceIndex) !== JSON.stringify(publicIndex)) {
    addFinding("ERROR", "GENERATED_INDEX_MISMATCH", "src/icons.json differs from public/icons.json");
  }

  const generatedCatalog = catalogFromIndex(sourceIndex || [], "source index");
  validateCatalog(generatedCatalog, "generated index", !catalog);
  if (catalog) compareCatalogs(generatedCatalog, catalog, "raw corpus versus generated index");
  const canonicalNames = catalog
    ? canonicalNamesFromCatalog(catalog)
    : new Set((sourceIndex || []).map(icon => icon?.name).filter(Boolean));
  const metadata = auditIconMetadata(canonicalNames);
  if (metadata) auditGeneratedMetadata(sourceIndex, metadata);

  if (!existsSync(SPRITES_DIR)) {
    addFinding("ERROR", "SPRITE_DIRECTORY_MISSING", SPRITES_DIR);
    return;
  }

  const actualSpriteFiles = directoryEntries(SPRITES_DIR)
    .filter(entry => entry.isFile() && extname(entry.name) === ".svg")
    .map(entry => entry.name)
    .sort(compareNames);
  const expectedSpriteFiles = expectedFamilies.flatMap(family =>
    expectedStyles.map(style => `${family}-${style}.svg`)
  ).sort(compareNames);
  if (!sameList(actualSpriteFiles, expectedSpriteFiles)) {
    addFinding("ERROR", "SPRITE_INVENTORY", `${actualSpriteFiles.length} files; expected ${expectedSpriteFiles.length}`);
  }

  for (const family of expectedFamilies) {
    for (const style of expectedStyles) {
      const file = join(SPRITES_DIR, `${family}-${style}.svg`);
      if (!existsSync(file)) continue;
      const sprite = readFileSync(file, "utf-8");
      const actualIds = [...sprite.matchAll(/<symbol\b[^>]*\bid="([^"]+)"/g)]
        .map(match => match[1])
        .sort(compareNames);
      const expectedIds = [...generatedCatalog]
        .filter(([key, styles]) => key.startsWith(`${family}::`) && styles.has(style))
        .map(([key]) => `${family}/${style}/${key.slice(key.indexOf("::") + 2)}`)
        .sort(compareNames);
      if (!sameList(actualIds, expectedIds)) {
        addFinding("ERROR", "SPRITE_SYMBOL_MISMATCH", `${family}-${style}.svg`);
      }
    }
  }
}

function auditRaw() {
  const catalog = new Map();
  const spriteIds = new Map();
  const numericGroups = new Map();
  let rawSvgCount = 0;
  let clipPathCount = 0;

  const rootEntries = directoryEntries(ICONS_DIR);
  for (const entry of rootEntries) {
    if (!entry.isDirectory()) addFinding("ERROR", "UNEXPECTED_ROOT_ENTRY", entry.name);
  }

  const families = directoryNames(ICONS_DIR);
  if (!sameList(families, expectedFamilies)) {
    addFinding("ERROR", "FAMILY_INVENTORY", families.join(", "));
  }

  for (const family of expectedFamilies) {
    const familyPath = join(ICONS_DIR, family);
    if (!existsSync(familyPath)) continue;
    const styles = directoryNames(familyPath);
    if (!sameList(styles, expectedStyles)) {
      addFinding("ERROR", "STYLE_INVENTORY", `${family}: ${styles.join(", ")}`);
    }

    for (const style of expectedStyles) {
      const stylePath = join(familyPath, style);
      if (!existsSync(stylePath)) continue;
      const entries = directoryEntries(stylePath);
      const files = [];
      const caseInsensitiveNames = new Map();

      for (const entry of entries) {
        const entryPath = join(stylePath, entry.name);
        if (!entry.isFile()) {
          addFinding("ERROR", "UNEXPECTED_NESTED_ENTRY", pathLabel(entryPath));
        } else if (extname(entry.name) !== ".svg") {
          addFinding("ERROR", "UNEXPECTED_STYLE_FILE", pathLabel(entryPath));
        } else {
          files.push(entry.name);
        }
      }
      files.sort(compareNames);
      if (files.length === 0) addFinding("ERROR", "EMPTY_STYLE_DIRECTORY", pathLabel(stylePath));

      for (const fileName of files) {
        const name = basename(fileName, ".svg");
        const file = join(stylePath, fileName);
        const key = `${family}::${name}`;
        const lowerName = name.toLowerCase();
        rawSvgCount++;

        if (caseInsensitiveNames.has(lowerName) && caseInsensitiveNames.get(lowerName) !== name) {
          addFinding("ERROR", "CASE_INSENSITIVE_COLLISION", `${family}/${style}: ${caseInsensitiveNames.get(lowerName)} and ${name}`);
        }
        caseInsensitiveNames.set(lowerName, name);

        if (!catalog.has(key)) catalog.set(key, new Set());
        catalog.get(key).add(style);
        if (!VALID_NAME.test(name)) addFinding("ERROR", "INVALID_KEBAB_CASE", name);

        const numeric = name.match(/^(.*)-(\d+)$/);
        if (numeric) {
          const numericKey = `${family}::${numeric[1]}`;
          if (!numericGroups.has(numericKey)) numericGroups.set(numericKey, new Set());
          numericGroups.get(numericKey).add(Number(numeric[2]));
        }
        if (/(?:-\d+){2,}$/.test(name)) addFinding("WARN", "REPEATED_NUMERIC_SUFFIX", name);

        const svg = readFileSync(file, "utf-8");
        if (svg.includes("\uFFFD") || /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(svg)) {
          addFinding("ERROR", "INVALID_TEXT_CONTENT", pathLabel(file));
        }
        if ((svg.match(/<svg\b/gi) || []).length !== 1 || !hasBalancedTags(svg)) {
          addFinding("ERROR", "MALFORMED_SVG_STRUCTURE", pathLabel(file));
        }
        if (/<!DOCTYPE/i.test(svg) || /<script\b/i.test(svg)) {
          addFinding("ERROR", "UNSAFE_SVG_CONTENT", pathLabel(file));
        }
        if (/(?:href|xlink:href)=["'](?!#)[^"']+["']/i.test(svg)) {
          addFinding("ERROR", "EXTERNAL_SVG_REFERENCE", pathLabel(file));
        }
        if (/&(?!#\d+;|#x[0-9a-f]+;|[a-z][a-z0-9]+;)/i.test(svg)) {
          addFinding("ERROR", "UNESCAPED_AMPERSAND", pathLabel(file));
        }

        const generatorMatch = svg.match(GENERATOR_SVG);
        if (!generatorMatch) {
          addFinding("ERROR", "GENERATOR_INCOMPATIBLE_SVG", pathLabel(file));
        } else {
          if (normalizedViewBox(generatorMatch[1]) !== "0 0 24 24") {
            addFinding("ERROR", "INVALID_VIEWBOX", `${pathLabel(file)}: ${generatorMatch[1]}`);
          }
          const body = generatorMatch[2].replace(/<!--[\s\S]*?-->/g, "").trim();
          if (!body || !RENDERABLE_ELEMENT.test(body)) addFinding("ERROR", "EMPTY_SVG_BODY", pathLabel(file));
        }

        const ids = localIds(svg);
        const idSet = new Set();
        for (const id of ids) {
          if (idSet.has(id)) addFinding("ERROR", "DUPLICATE_LOCAL_ID", `${pathLabel(file)}: ${id}`);
          idSet.add(id);
        }
        for (const reference of localReferences(svg)) {
          if (!idSet.has(reference)) addFinding("ERROR", "UNRESOLVED_LOCAL_REFERENCE", `${pathLabel(file)}: ${reference}`);
        }

        const spriteKey = `${family}/${style}`;
        if (!spriteIds.has(spriteKey)) spriteIds.set(spriteKey, new Map());
        const idsForSprite = spriteIds.get(spriteKey);
        for (const id of ids) {
          if (idsForSprite.has(id)) {
            addFinding("ERROR", "DUPLICATE_SPRITE_ID", `${spriteKey}: ${id}`);
          }
          idsForSprite.set(id, fileName);
        }

        if (/<clipPath\b/i.test(svg)) {
          clipPathCount++;
          addFinding("INFO", "CLIP_PATH", name);
        }

        if (/\sstyle=["']|<style\b/i.test(svg)) addFinding("WARN", "INLINE_STYLE", pathLabel(file));
        for (const paint of svg.matchAll(/\b(fill|stroke)=["']([^"']+)["']/gi)) {
          const value = paint[2].trim().toLowerCase();
          const allowed = new Set(["none", "black", "currentcolor", "white", FAMILY_COLORS[family]]);
          if (!allowed.has(value) && !value.startsWith("url(#")) {
            addFinding("WARN", "UNEXPECTED_PAINT", `${family}: ${paint[1]}=${paint[2]}`);
          }
        }
      }
    }
  }

  validateCatalog(catalog, "raw corpus", false);
  if (rawSvgCount !== library.iconVariantCount) {
    addFinding("ERROR", "RAW_SVG_COUNT", `${rawSvgCount}; expected ${library.iconVariantCount}`);
  }

  for (const [key, suffixes] of numericGroups) {
    const values = [...suffixes].sort((a, b) => a - b);
    const repeatedOrLarge = values.some(value => value > 9);
    const hasGap = values[0] > 1 || values.some((value, index) => index > 0 && value > values[index - 1] + 1);
    if (repeatedOrLarge || hasGap) {
      addFinding("WARN", "NUMERIC_SEQUENCE", `${key}: ${values.join(", ")}`);
    }
  }

  return { catalog, rawSvgCount, clipPathCount, numericConcepts: numericGroups.size };
}

function report(summary) {
  console.log(`Icon audit: ${summary.svgCount.toLocaleString("en-US")} SVGs, ${summary.conceptCount.toLocaleString("en-US")} concepts, ${expectedFamilies.length} families, ${expectedFamilies.length * expectedStyles.length} family/style directories`);

  const severityOrder = { ERROR: 0, WARN: 1, INFO: 2 };
  const ordered = [...findings.entries()].sort((a, b) => {
    const severityDifference = severityOrder[a[1].severity] - severityOrder[b[1].severity];
    return severityDifference || compareNames(a[0], b[0]);
  });

  for (const [code, finding] of ordered) {
    console.log(`\n${finding.severity} ${code}: ${finding.total} occurrence${finding.total === 1 ? "" : "s"}`);
    const groups = [...finding.groups.entries()].sort((a, b) => compareNames(a[0], b[0]));
    const visible = showAll ? groups : groups.slice(0, MAX_EXAMPLES);
    for (const [label, count] of visible) {
      console.log(`  ${label}${count > 1 ? ` (${count})` : ""}`);
    }
    if (!showAll && groups.length > visible.length) {
      console.log(`  ... ${groups.length - visible.length} more group${groups.length - visible.length === 1 ? "" : "s"}; use --all`);
    }
  }

  const errorCount = ordered
    .filter(([, finding]) => finding.severity === "ERROR")
    .reduce((total, [, finding]) => total + finding.total, 0);
  const warningCount = ordered
    .filter(([, finding]) => finding.severity === "WARN")
    .reduce((total, [, finding]) => total + finding.total, 0);
  console.log(`\nResult: ${errorCount} error occurrence${errorCount === 1 ? "" : "s"}, ${warningCount} warning occurrence${warningCount === 1 ? "" : "s"}; no files modified`);
  return errorCount > 0 ? 1 : 0;
}

try {
  let rawSummary = null;
  let catalog = null;

  if (!existsSync(ICONS_DIR)) {
    addFinding(requireIcons ? "ERROR" : "WARN", requireIcons ? "RAW_ICONS_REQUIRED" : "RAW_ICONS_MISSING", ICONS_DIR);
  } else {
    rawSummary = auditRaw();
    catalog = rawSummary.catalog;
  }

  auditGenerated(catalog);
  const sourceIndex = readJson(OUTPUT_SRC, "source index") || [];
  const summary = {
    svgCount: rawSummary?.rawSvgCount ?? sourceIndex.reduce((total, icon) => total + (icon.styles?.length || 0), 0),
    conceptCount: rawSummary?.catalog.size ?? sourceIndex.length,
  };
  process.exitCode = report(summary);
} catch (error) {
  console.error(`Audit failed: ${error.message}`);
  process.exitCode = 2;
}

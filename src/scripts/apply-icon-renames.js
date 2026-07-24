import { createHash } from "crypto";
import { existsSync, readFileSync, readdirSync, renameSync, unlinkSync } from "fs";
import { join } from "path";
import library from "../data/library.json" with { type: "json" };
import manifest from "../data/icon-renames.json" with { type: "json" };

const ICONS_DIR = "./public/icons";
const VALID_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const args = new Set(process.argv.slice(2));

for (const arg of args) {
  if (arg !== "--apply") {
    console.error(`Unknown argument: ${arg}`);
    process.exit(2);
  }
}

const apply = args.has("--apply");
const expectedFamilies = [...library.families].sort(compareNames);
const expectedStyles = [...library.styles].sort(compareNames);

function compareNames(a, b) {
  const lowerA = a.toLowerCase();
  const lowerB = b.toLowerCase();
  if (lowerA < lowerB) return -1;
  if (lowerA > lowerB) return 1;
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function directoryNames(path) {
  return readdirSync(path, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort(compareNames);
}

function assertSameList(actual, expected, label) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label}: expected [${expected.join(", ")}], found [${actual.join(", ")}]`);
  }
}

function svgPath(family, style, name) {
  return join(ICONS_DIR, family, style, `${name}.svg`);
}

function hashFile(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function validateName(value, label) {
  if (typeof value !== "string" || !VALID_NAME.test(value)) {
    throw new Error(`${label} must be a lowercase kebab-case name: ${value}`);
  }
}

function validateCorpus() {
  if (!existsSync(ICONS_DIR)) throw new Error(`Raw icon corpus is missing: ${ICONS_DIR}`);
  assertSameList(directoryNames(ICONS_DIR), expectedFamilies, "Raw icon families");
  for (const family of expectedFamilies) {
    assertSameList(directoryNames(join(ICONS_DIR, family)), expectedStyles, `Raw styles for ${family}`);
  }
}

function buildPlan() {
  if (!manifest.renames || typeof manifest.renames !== "object" || Array.isArray(manifest.renames)) {
    throw new Error("Rename manifest must contain a renames object");
  }
  if (!Array.isArray(manifest.replacements)) {
    throw new Error("Rename manifest must contain a replacements array");
  }

  const moves = [];
  const replacements = [];
  const targets = new Set();

  for (const [from, to] of Object.entries(manifest.renames)) {
    if (typeof from !== "string" || from.length === 0) throw new Error("Rename source must be a non-empty string");
    validateName(to, `Target for ${from}`);
    if (from === to) throw new Error(`Rename source and target are identical: ${from}`);

    for (const family of expectedFamilies) {
      for (const style of expectedStyles) {
        const source = svgPath(family, style, from);
        const target = svgPath(family, style, to);
        const targetKey = target.toLowerCase();
        if (targets.has(targetKey)) throw new Error(`Duplicate rename target: ${target}`);
        targets.add(targetKey);

        const sourceExists = existsSync(source);
        const targetExists = existsSync(target);
        if (sourceExists && targetExists) throw new Error(`Rename target already exists: ${target}`);
        if (!sourceExists && !targetExists) throw new Error(`Neither rename source nor target exists: ${source}`);
        moves.push({ family, style, from, to, source, target, applied: !sourceExists && targetExists });
      }
    }
  }

  for (const replacement of manifest.replacements) {
    const { family, remove, from, to } = replacement;
    if (!expectedFamilies.includes(family)) throw new Error(`Unknown replacement family: ${family}`);
    validateName(remove, `Replacement removal in ${family}`);
    validateName(from, `Replacement source in ${family}`);
    validateName(to, `Replacement target in ${family}`);
    if (remove !== to) throw new Error(`Replacement target must reuse the removed name: ${family}/${remove}`);

    for (const style of expectedStyles) {
      const source = svgPath(family, style, from);
      const target = svgPath(family, style, to);
      const sourceExists = existsSync(source);
      const targetExists = existsSync(target);
      if (sourceExists && !targetExists) throw new Error(`Replacement removal target is missing: ${target}`);
      if (!sourceExists && !targetExists) throw new Error(`Applied replacement target is missing: ${target}`);
      replacements.push({ family, style, from, to, source, target, applied: !sourceExists && targetExists });
    }
  }

  return { moves, replacements };
}

function printPlan(plan) {
  const pendingMoves = plan.moves.filter(operation => !operation.applied);
  const pendingReplacements = plan.replacements.filter(operation => !operation.applied);
  const appliedMoves = plan.moves.length - pendingMoves.length;
  const appliedReplacements = plan.replacements.length - pendingReplacements.length;

  console.log(`Icon rename plan: ${pendingMoves.length + pendingReplacements.length} pending moves, ${pendingReplacements.length} pending removals`);
  if (appliedMoves || appliedReplacements) {
    console.log(`Already applied: ${appliedMoves + appliedReplacements} moves, ${appliedReplacements} removals`);
  }
  for (const [from, to] of Object.entries(manifest.renames)) {
    const count = pendingMoves.filter(operation => operation.from === from && operation.to === to).length;
    if (count) console.log(`  ${from} -> ${to} (${count} files)`);
  }
  for (const replacement of manifest.replacements) {
    const count = pendingReplacements.filter(operation =>
      operation.family === replacement.family && operation.from === replacement.from
    ).length;
    if (count) {
      console.log(`  ${replacement.family}/${replacement.remove}: remove duplicate, then ${replacement.from} -> ${replacement.to} (${count} styles)`);
    }
  }
  return { pendingMoves, pendingReplacements };
}

function applyPlan(pendingMoves, pendingReplacements) {
  const stagedRemovals = [];
  const completedMoves = [];

  try {
    for (const operation of pendingReplacements) {
      const backup = `${operation.target}.rename-backup`;
      if (existsSync(backup)) throw new Error(`Replacement backup already exists: ${backup}`);
      renameSync(operation.target, backup);
      stagedRemovals.push({ original: operation.target, backup });
    }

    for (const operation of [...pendingMoves, ...pendingReplacements]) {
      const beforeHash = hashFile(operation.source);
      renameSync(operation.source, operation.target);
      const afterHash = hashFile(operation.target);
      if (beforeHash !== afterHash) throw new Error(`SVG bytes changed while renaming: ${operation.source}`);
      completedMoves.push(operation);
    }

    for (const removal of stagedRemovals) unlinkSync(removal.backup);
  } catch (error) {
    for (const operation of completedMoves.reverse()) {
      if (existsSync(operation.target) && !existsSync(operation.source)) {
        renameSync(operation.target, operation.source);
      }
    }
    for (const removal of stagedRemovals.reverse()) {
      if (existsSync(removal.backup) && !existsSync(removal.original)) {
        renameSync(removal.backup, removal.original);
      }
    }
    throw error;
  }
}

try {
  validateCorpus();
  const plan = buildPlan();
  const { pendingMoves, pendingReplacements } = printPlan(plan);

  if (!apply) {
    console.log("Dry run only. Re-run with --apply to modify raw filenames.");
  } else if (pendingMoves.length === 0 && pendingReplacements.length === 0) {
    console.log("Rename manifest is already fully applied.");
  } else {
    applyPlan(pendingMoves, pendingReplacements);
    console.log(`Applied ${pendingMoves.length + pendingReplacements.length} moves and ${pendingReplacements.length} removals.`);
  }
} catch (error) {
  console.error(`Rename failed: ${error.message}`);
  process.exit(1);
}

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "fs";
import { join, basename, extname } from "path";

const ICONS_DIR     = "./public/icons";
const SPRITES_DIR   = "./public/sprites";
const OUTPUT_SRC    = "./src/icons.json";
const OUTPUT_PUBLIC = "./public/icons.json";

mkdirSync(SPRITES_DIR, { recursive: true });

const result = {};

// Walk: family → style → icon
const families = readdirSync(ICONS_DIR);

for (const family of families) {
  const familyPath = join(ICONS_DIR, family);
  const styles = readdirSync(familyPath);

  for (const style of styles) {
    const stylePath = join(familyPath, style);
    const files = readdirSync(stylePath);
    const symbols = [];

    for (const file of files) {
      if (extname(file) !== ".svg") continue;

      const name = basename(file, ".svg");
      const key = `${family}::${name}`;

      if (!result[key]) {
        result[key] = {
          name,
          family,
          styles: [],
          categories: [],
          tags: [],
        };
      }

      result[key].styles.push(style.toLowerCase());

      // Build sprite symbol
      const svgContent = readFileSync(join(stylePath, file), "utf-8");
      const match = svgContent.match(
        /<svg[^>]*viewBox="([^"]+)"[^>]*>([\s\S]*)<\/svg>/i
      );
      if (match) {
        const [, viewBox, inner] = match;
        symbols.push(
          `<symbol id="${family}/${style.toLowerCase()}/${name}" viewBox="${viewBox}">\n${inner.trim()}\n</symbol>`
        );
      }
    }

    // Write sprite file
    const spriteKey = `${family}-${style.toLowerCase()}`;
    const sprite = `<svg xmlns="http://www.w3.org/2000/svg">\n${symbols.join("\n")}\n</svg>`;
    writeFileSync(join(SPRITES_DIR, `${spriteKey}.svg`), sprite);
    console.log(`  ✓ sprite ${spriteKey}.svg (${symbols.length} icons)`);
  }
}

const icons = Object.values(result);
writeFileSync(OUTPUT_SRC,    JSON.stringify(icons, null, 2));
writeFileSync(OUTPUT_PUBLIC, JSON.stringify(icons, null, 2));
console.log(`✓ Built index: ${icons.length} icons, ${families.length} families`);

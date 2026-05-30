import { readdirSync, readFileSync, writeFileSync } from "fs";
import { join, basename, extname } from "path";

const ICONS_DIR     = "./public/icons";
const OUTPUT_SRC    = "./src/icons.json";
const OUTPUT_PUBLIC = "./public/icons.json";

const result = {};

// Walk: family → style → icon
const families = readdirSync(ICONS_DIR);

for (const family of families) {
  const familyPath = join(ICONS_DIR, family);
  const styles = readdirSync(familyPath);

  for (const style of styles) {
    const stylePath = join(familyPath, style);
    const files = readdirSync(stylePath);

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
    }
  }
}

const icons = Object.values(result);
writeFileSync(OUTPUT_SRC,    JSON.stringify(icons, null, 2));
writeFileSync(OUTPUT_PUBLIC, JSON.stringify(icons, null, 2));
console.log(`✓ Built index: ${icons.length} icons`);
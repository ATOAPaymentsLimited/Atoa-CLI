// Generates src/lib/atoa-logo.ts from the brand asset.
//
// Why codegen instead of `import logo from "...svg"`: the CLI runs under three toolchains
// (tsup bundle, vitest, tsx dev) and publishes only bin/ + dist/, so the SVG can't be read
// at runtime and a `.svg` text-loader would need configuring in all three. Emitting a plain
// .ts module keeps the asset as the single source of truth while every toolchain just imports
// normal TypeScript. Re-run `npm run gen:logo` (build does this automatically) after editing
// the asset. We rewrite only the root <svg> tag (size via CSS, add an a11y label, keep the
// asset's viewBox); the path geometry is copied verbatim.
import {readFileSync, writeFileSync} from "node:fs";

const asset = "assets/Atoa-Brand-Mark-Red.svg";
const raw = readFileSync(asset, "utf8");
const viewBox = raw.match(/viewBox="([^"]*)"/)?.[1] ?? "0 0 78 32";
const svg = raw
  .replace(/\s*[\r\n]\s*/g, "")
  .replace(
    /<svg\b[^>]*>/,
    `<svg class="brand" viewBox="${viewBox}" role="img" aria-label="Atoa" fill="none" xmlns="http://www.w3.org/2000/svg">`
  );

const out = `// GENERATED from ${asset} by scripts/gen-logo.mjs — do not edit by hand.
// Run \`npm run gen:logo\` after changing the asset (the build does this automatically).
export const ATOA_LOGO_SVG = ${JSON.stringify(svg)};
`;
writeFileSync("src/lib/atoa-logo.ts", out);
console.log(`gen-logo: wrote src/lib/atoa-logo.ts (${svg.length} bytes)`);

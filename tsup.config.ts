import {defineConfig} from "tsup";
import {PUBLIC_BASE_URL} from "./src/lib/env";

const baseUrl = process.env.ATOA_BASE_URL?.trim() || PUBLIC_BASE_URL;

export default defineConfig({
  entry: {cli: "src/cli.ts", index: "src/index.ts", bootstrap: "src/lib/bootstrap.ts"},
  format: ["esm"],
  target: "node20",
  clean: true,
  sourcemap: true,
  define: {
    BASE_URL: JSON.stringify(baseUrl)
  }
});

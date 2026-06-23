import {defineConfig} from "tsup";
import {PUBLIC_BASE_URL, PUBLIC_DASHBOARD_URL} from "./src/lib/env";

const baseUrl = process.env.ATOA_BASE_URL?.trim() || PUBLIC_BASE_URL;
const dashboardUrl = process.env.ATOA_DASHBOARD_URL?.trim() || PUBLIC_DASHBOARD_URL;

export default defineConfig({
  entry: {cli: "src/cli.ts", index: "src/index.ts", bootstrap: "src/lib/bootstrap.ts"},
  format: ["cjs"],
  target: "node20",
  clean: true,
  sourcemap: true,
  noExternal: ["citty", /^@inquirer\//],
  define: {
    BASE_URL: JSON.stringify(baseUrl),
    DASHBOARD_URL: JSON.stringify(dashboardUrl)
  }
});

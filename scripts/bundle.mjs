// Bundle src/ into a single dist/worker.js for manual Dashboard upload.
import { build } from "esbuild";
import { mkdirSync } from "node:fs";

const checkOnly = process.argv.includes("--check-only");

mkdirSync("dist", { recursive: true });
try {
  const r = await build({
    entryPoints: ["src/index.js"],
    bundle: true,
    format: "esm",
    platform: "neutral",
    target: "es2022",
    outfile: "dist/worker.js",
    write: !checkOnly,
    logLevel: checkOnly ? "warning" : "info",
    minify: false,
  });
  if (!checkOnly) console.log("built dist/worker.js");
} catch (e) {
  console.error("bundle failed:", e.message);
  process.exit(1);
}

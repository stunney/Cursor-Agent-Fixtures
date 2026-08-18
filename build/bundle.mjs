import * as esbuild from "esbuild";
import { mkdirSync } from "node:fs";

mkdirSync("scripts", { recursive: true });

const shared = {
  platform: "node",
  format: "esm",
  target: "node20",
  bundle: true,
  sourcemap: true,
  packages: "bundle",
};

await esbuild.build({
  ...shared,
  entryPoints: ["src/hook.ts"],
  outfile: "scripts/hook.mjs",
});

await esbuild.build({
  ...shared,
  entryPoints: ["src/mcp-server.ts"],
  outfile: "scripts/mcp-server.mjs",
});

console.log("Bundled scripts/hook.mjs and scripts/mcp-server.mjs");

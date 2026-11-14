import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/utils/format.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: true,
  target: "es2022",
  outDir: "dist",
  splitting: false,
  external: ["@earendil-works/pi-coding-agent", "@earendil-works/pi-ai", "@earendil-works/pi-tui"],
});

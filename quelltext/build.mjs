import * as esbuild from "esbuild";
import path from "node:path";
const shim = (n) => path.resolve("shims", n + ".js");
await esbuild.build({
  entryPoints: [process.argv[2] || "src/app.js"],
  bundle: true, format: "iife", platform: "browser", target: "es2020", minify: true,
  outfile: process.argv[3] || "dist/app.js",
  inject: ["shims/inject.js"],
  define: { "process.env.NODE_ENV": '"production"' },
  alias: { "fs-extra": shim("fs-extra"), os: shim("os"), https: shim("https"), agentkeepalive: shim("agentkeepalive"), "progress-stream": shim("progress-stream"), crypto: shim("crypto"), path: "path-browserify", stream: "stream-browserify", buffer: "buffer", events: "events", process: "process", url: "url" },
  mainFields: ["browser", "module", "main"],
  logLevel: "warning",
});

import { build } from 'esbuild';
import fs from 'node:fs';
fs.mkdirSync('dist/ui', {recursive:true});
await build({entryPoints:['src/ui/main.tsx'],bundle:true,outfile:'dist/ui/app.js',platform:'browser',format:'iife',minify:true,sourcemap:false,loader:{'.woff2':'file','.woff':'file','.ttf':'file'}});
await build({entryPoints:['src/electron/main.ts','src/electron/preload.ts','src/electron/reader-preload.ts'],bundle:true,outdir:'dist/electron',platform:'node',format:'cjs',outExtension:{'.js':'.cjs'},external:['electron','better-sqlite3'],target:'node22'});
fs.copyFileSync('src/ui/index.html','dist/ui/index.html');
console.log('Build complete');

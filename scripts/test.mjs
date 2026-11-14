import {build} from 'esbuild';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
await build({entryPoints:['tests/core.test.ts','tests/ai.test.ts'],bundle:true,outdir:'qa',outExtension:{'.js':'.cjs'},platform:'node',format:'cjs',external:['better-sqlite3']});
const result=spawnSync(require('electron'),['--test','qa/core.test.cjs','qa/ai.test.cjs'],{stdio:'inherit',env:{...process.env,ELECTRON_RUN_AS_NODE:'1'}});process.exit(result.status??1);

import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';
await mkdir('dist', { recursive: true });
await build({entryPoints:['src/browser.ts'],bundle:true,platform:'browser',format:'iife',outfile:'dist/renderer.js',alias:{'@shared':'./upstream/mf/src/shared'},legalComments:'eof'});

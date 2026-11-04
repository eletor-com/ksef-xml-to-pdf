// Download unmodified MF sources directly; never execute downloaded shell scripts.
import {readFile,writeFile,mkdir,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const lockPath=new URL('../upstream.lock.json',import.meta.url);
const lock=JSON.parse(await readFile(lockPath,'utf8'));
const update=process.argv[2]==='--update';
const commit=update?process.argv[3]:lock.commit;
if (!/^[a-f0-9]{40}$/.test(commit??'')) throw new Error('Provide a full 40-character commit SHA from CIRFMF/ksef-pdf-generator.');
const response=await fetch(`https://codeload.github.com/CIRFMF/ksef-pdf-generator/tar.gz/${commit}`,{signal:AbortSignal.timeout(120000)});
if (!response.ok) throw new Error(`MF source download HTTP ${response.status}`);
const archive=Buffer.from(await response.arrayBuffer());
if (archive.length>30*1024*1024) throw new Error('Unexpected archive size.');
const sha256=createHash('sha256').update(archive).digest('hex');
if (!update && sha256!==lock.archiveSha256) throw new Error('MF source archive checksum mismatch.');
const temp=await mkdtemp(join(tmpdir(),'mf-source-'));
try {
 const archivePath=join(temp,'source.tar.gz');await writeFile(archivePath,archive);
 const target=new URL('../upstream/mf/',import.meta.url);
 await rm(target,{recursive:true,force:true});await mkdir(target,{recursive:true});
 execFileSync('tar',['-xzf',archivePath,'--strip-components=1','-C',target.pathname]);
 if (update) await writeFile(lockPath,JSON.stringify({repository:'https://github.com/CIRFMF/ksef-pdf-generator',commit,archiveSha256:sha256},null,2)+'\n');
 console.log(`MF source ready at commit ${commit}; archive SHA-256 verified.`);
} finally {await rm(temp,{recursive:true,force:true});}

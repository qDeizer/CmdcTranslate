import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { prepare } from './run.mjs';
import { compileNative, parseNativeLines } from '../src/commandcode.mjs';
import { decodeResponses } from '../src/responses.mjs';
const {profile,credentials}=await prepare();
profile.models['astra-muse'].efforts=['high'];
const turn=decodeResponses({model:'astra-muse',input:'Use read_file to read input.txt.',
  reasoning:{effort:'high'},max_output_tokens:4096,
  tools:[{type:'function',name:'read_file',parameters:{type:'object',properties:{path:{type:'string'}},required:['path']}}]}, {},profile);
const request=compileNative(turn,profile,{sessionId:randomUUID(),threadId:randomUUID()},credentials);
const res=await fetch(request.url,{method:'POST',headers:request.headers,body:JSON.stringify(request.body),signal:AbortSignal.timeout(120000)});
const events=[];
if(res.ok) for await(const e of parseNativeLines(res.body)) events.push({type:e.type,keys:Object.keys(e),textLength:e.text?.length,deltaLength:e.delta?.length,reason:e.rawFinishReason??e.finishReason,usage:e.totalUsage});
const report={date:new Date().toISOString(),model:turn.publicModel,effort:'high',status:res.status,events};
await writeFile(new URL('../evidence/native-probe.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));

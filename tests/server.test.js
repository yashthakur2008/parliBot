import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { createServer } from '../server/index.js';
import { createModel } from '../server/model.js';
import { validateInput } from '../server/prompts.js';

async function listen(server,t){server.listen(0,'127.0.0.1'); await once(server,'listening'); t.after(()=>new Promise(r=>{server.closeAllConnections();server.close(r)}));return `http://127.0.0.1:${server.address().port}`;}
const localTag={name:'local',size:2000000000,digest:'a'.repeat(64),details:{format:'gguf'}};
const localShow={details:{format:'gguf'},model_info:{'general.architecture':'llama','general.parameter_count':1000,'llama.context_length':131072},tensors:[{name:'weights'}]};
const input={model:'local',mode:'speech',config:{resolution:'Test',side:'gov',difficulty:'medium'},speechIndex:1,transcript:[]};
const offline={status:async()=>{throw Error('offline')},generate:async()=>{throw Error('offline')}};
async function post(base,body,headers={}){return fetch(base+'/api/generate',{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(body)});}

test('status and missing inference are honest, coach retains metrics',async t=>{
 const base=await listen(createServer({model:offline,speech:null}),t);
 const status=await (await fetch(base+'/api/status')).json(); assert.equal(status.ok,false);assert.deepEqual(status.models,[]);assert.equal(status.speech.available,false);
 assert.equal((await post(base,input)).status,503);
 const response=await post(base,{...input,mode:'coach',transcript:[{text:'one two three',duration:3,side:'gov'}]});
 assert.equal(response.status,200); const report=await response.json();assert.equal(report.metrics.words,3);assert.equal(report.qualitativeAvailable,false);assert.match(report.text,/unavailable/i);
});
test('reject bad inputs, foreign origin/host, huge body, private static paths',async t=>{
 const base=await listen(createServer({model:offline,speech:null}),t);
 for(const body of [{...input,mode:'shell'},{...input,model:'http://evil'},{...input,transcript:[{text:'x',duration:-1}]},{...input,speechIndex:7}])assert.equal((await post(base,body)).status,400);
 assert.equal((await post(base,input,{origin:'https://evil.test'})).status,403);
 assert.equal(await new Promise((resolve,reject)=>{const req=http.get(base+'/api/status',{headers:{host:'evil.test'}},res=>{res.resume();resolve(res.statusCode)});req.on('error',reject)}),403);
 assert.equal((await post(base,{...input,notes:'x'.repeat(300000)})).status,413);
 for(const path of ['/server/index.js','/../package.json','/%2e%2e%2fpackage.json','/.git/config'])assert.ok([400,404].includes((await fetch(base+path)).status));
});
test('Ollama transport uses fixed URLs, real local test HTTP, model allowlist',async t=>{
 const seen=[];
 const upstream=await listen(http.createServer(async(req,res)=>{let body='';for await(const chunk of req)body+=chunk;seen.push({url:req.url,body});res.setHeader('content-type','application/json');res.end(JSON.stringify(req.url==='/api/tags'?{models:[localTag]}:req.url==='/api/show'?localShow:{message:{content:'A reasoned response'}}));}),t);
 const model=createModel({fetchImpl:(url,options)=>{assert.ok(url.startsWith('http://127.0.0.1:11434/'));return fetch(upstream+new URL(url).pathname,options)}});
 const base=await listen(createServer({model,speech:null}),t);
 assert.equal((await (await post(base,input)).json()).text,'A reasoned response');
 assert.equal((await post(base,{...input,model:'absent'})).status,503);
 assert.equal(JSON.parse(seen.find(x=>x.url==='/api/chat').body).stream,false);
});
test('client cancellation propagates to model signal',async t=>{
 let began;const started=new Promise(r=>began=r);let canceled;const aborted=new Promise(r=>canceled=r);
 const model={status:async()=>[{name:'local'}],generate:async(_input,{signal})=>{began();await new Promise((_,reject)=>signal.addEventListener('abort',()=>{canceled();reject(signal.reason)},{once:true}));}};
 const base=await listen(createServer({model,speech:null}),t);const controller=new AbortController();
 const response=fetch(base+'/api/generate',{method:'POST',body:JSON.stringify(input),headers:{'content-type':'application/json'},signal:controller.signal}).catch(()=>{});
 await started;controller.abort();await Promise.race([aborted,new Promise((_,reject)=>setTimeout(()=>reject(Error('not canceled')),1000))]);await response;
});
test('speech adapter factory serves status and authenticated routes and closes',async t=>{
 let closed=false;
 const speech={createSpeechAdapter:()=>({status:async()=>({available:true,mode:'local'}),handle:async(req,res)=>{res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({ok:true}));return true},close:()=>{closed=true}})};
 const server=createServer({model:offline,speech});const base=await listen(server,t);
 assert.equal((await (await fetch(base+'/api/status')).json()).speech.available,true);
 assert.equal((await fetch(base+'/api/speech/start',{method:'POST'})).status,200);
 assert.equal((await fetch(base+'/api/speech/start',{method:'POST',headers:{origin:'https://evil.test'}})).status,403);
 await new Promise(r=>server.close(r));assert.equal(closed,true);
});
test('streaming forwards split Ollama NDJSON as deltas and complete text',async t=>{
 const upstream=await listen(http.createServer(async(req,res)=>{
  if(req.url==='/api/show'){res.end(JSON.stringify(localShow));return;}
  if(req.url==='/api/tags'){res.end(JSON.stringify({models:[localTag]}));return;}
  let body='';for await(const c of req)body+=c;assert.equal(JSON.parse(body).stream,true);
  res.setHeader('content-type','application/x-ndjson');
  res.write('{"message":{"content":"First "},"done":false}\n{"mess');
  setTimeout(()=>res.end('age":{"content":"sentence."},"done":false}\n{"done":true}\n'),10);
 }),t);
 const model=createModel({fetchImpl:(url,options)=>fetch(upstream+new URL(url).pathname,options)});
 const base=await listen(createServer({model,speech:null}),t);
 const response=await post(base,{...input,stream:true});
 assert.match(response.headers.get('content-type'),/ndjson/);
 assert.deepEqual((await response.text()).trim().split('\n').map(JSON.parse),[{delta:'First '},{delta:'sentence.'},{done:true,text:'First sentence.'}]);
});
test('stream failures are bounded and do not claim completed speech',async t=>{
 const model={status:async()=>[{name:'local'}],async *stream(){yield 'partial';throw Error('SECRET private upstream error')}};
 const base=await listen(createServer({model,speech:null}),t);
 const response=await post(base,{...input,stream:true});const text=await response.text();const lines=text.trim().split('\n').map(JSON.parse);
 assert.deepEqual(lines[0],{delta:'partial'});assert.equal(lines[1].done,true);assert.ok(lines[1].error);assert.equal(lines[1].text,undefined);assert.ok(!text.includes('SECRET'));
});
test('stream cancellation aborts upstream generator',async t=>{
 let canceled;const aborted=new Promise(r=>canceled=r);
 const model={async *stream(_input,{signal}){yield 'start';await new Promise((_,reject)=>signal.addEventListener('abort',()=>{canceled();reject(signal.reason)},{once:true}));}};
 const base=await listen(createServer({model,speech:null}),t);const controller=new AbortController();
 const response=await fetch(base+'/api/generate',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...input,stream:true}),signal:controller.signal});
 const reader=response.body.getReader();await reader.read();controller.abort();
 await Promise.race([aborted,new Promise((_,reject)=>setTimeout(()=>reject(Error('stream not aborted')),1000))]);
});
test('stream transport rejects truncated completion',async t=>{
 const upstream=await listen(http.createServer((req,res)=>res.end(req.url==='/api/tags'?JSON.stringify({models:[localTag]}):req.url==='/api/show'?JSON.stringify(localShow):'{"message":{"content":"unfinished"}}\n')),t);
 const model=createModel({fetchImpl:(url,options)=>fetch(upstream+new URL(url).pathname,options)});
 const base=await listen(createServer({model,speech:null}),t);const response=await post(base,{...input,stream:true});const lines=(await response.text()).trim().split('\n').map(JSON.parse);
 assert.ok(lines.at(-1).error);assert.equal(lines.at(-1).text,undefined);
});
test('only verified on-device GGUF models are listed and cloud/unknown models never infer',async t=>{
 const local={name:'verified',size:2000000000,digest:'a'.repeat(64),details:{format:'gguf'}};
 const tags=[local,{...local,name:'large-cloud'},{...local,name:'remoteAlias',remote_host:'https://ollama.com'},{...local,name:'unknown'},{...local,name:'hiddenRemote'}];
 const calls=[];
 const upstream=await listen(http.createServer(async(req,res)=>{let body='';for await(const chunk of req)body+=chunk;const parsed=body?JSON.parse(body):{};calls.push({path:req.url,model:parsed.model});
 let result;
 if(req.url==='/api/tags')result={models:tags};
 else if(req.url==='/api/show')result=parsed.model==='unknown'?{}:{details:{format:'gguf'},model_info:{'general.architecture':'llama','general.parameter_count':1000,'llama.context_length':131072},tensors:[{name:'weights'}],...(parsed.model==='hiddenRemote'?{remote_model:'cloud-model'}:{})};
 else result={message:{content:'should only generate verified'}};
 res.end(JSON.stringify(result));}),t);
 const model=createModel({fetchImpl:(url,options)=>fetch(upstream+new URL(url).pathname,options)});
 assert.deepEqual(await model.status(),[{name:'verified'}]);
 for(const name of ['large-cloud','remoteAlias','unknown','hiddenRemote'])await assert.rejects(model.generate({...input,model:name}));
 assert.ok(!calls.some(call=>call.path==='/api/chat'));
});
test('stream rejects malformed frames without a success terminal',async t=>{
 const upstream=await listen(http.createServer((req,res)=>res.end(req.url==='/api/tags'?JSON.stringify({models:[localTag]}):req.url==='/api/show'?JSON.stringify(localShow):'{bad json}\n{"done":true}\n')),t);
 const model=createModel({fetchImpl:(url,options)=>fetch(upstream+new URL(url).pathname,options)});
 const base=await listen(createServer({model,speech:null}),t);const response=await post(base,{...input,stream:true});const result=await response.text();assert.ok(result.includes('error'));assert.ok(!result.includes('"text":'));
});
for (const kind of ['frame', 'cumulative']) test(`stream ${kind} cap rejects otherwise complete output`,async()=>{
 const limit=1024*1024;
 const frame=text=>JSON.stringify({message:{content:text}})+'\n';
 // Cumulative frames are individually small and arrive one per stream pull.
 const chunks=kind==='frame'?[frame('x'.repeat(limit))]:Array(17).fill(frame('x'.repeat(65536)));
 chunks.push('{"done":true}\n');
 const model=createModel({fetchImpl:async(url)=>{
  if(url.endsWith('/api/tags'))return Response.json({models:[localTag]});
  if(url.endsWith('/api/show'))return Response.json(localShow);
  let index=0;
  return new Response(new ReadableStream({pull(controller){
   if(index===chunks.length)controller.close();
   else controller.enqueue(new TextEncoder().encode(chunks[index++]));
  }}));
 }});
 let forwarded=0;
 await assert.rejects(async()=>{for await(const delta of model.stream(validateInput(input))){forwarded+=delta.length;}},kind==='frame'?/frame too large/:/output too large/);
 assert.ok(forwarded<=limit,'never forward text beyond the output cap');
 assert.equal(forwarded,kind==='frame'?0:limit);
});
test('model explicitly reserves full context and scales short-speech output budget',async t=>{
 const bodies=[];const upstream=await listen(http.createServer(async(req,res)=>{let body='';for await(const chunk of req)body+=chunk;if(req.url==='/api/chat')bodies.push(JSON.parse(body));res.end(JSON.stringify(req.url==='/api/tags'?{models:[localTag]}:req.url==='/api/show'?localShow:{message:{content:'short'}}));}),t);
 const model=createModel({fetchImpl:(url,options)=>fetch(upstream+new URL(url).pathname,options)});const base=await listen(createServer({model,speech:null}),t);
 const response=await post(base,{...input,config:{...input.config,durations:[15,15,15,15,15,15]}});assert.equal(response.status,200);
 assert.equal(bodies[0].options.num_ctx,32768);assert.ok(bodies[0].options.num_predict<=100);
 const tooLong=await post(base,{...input,transcript:Array.from({length:10},()=>({text:'x'.repeat(10000),side:'gov'}))});assert.equal(tooLong.status,400);assert.match((await tooLong.json()).error,/context/i);assert.equal(bodies.length,1);
 const huge={...input,transcript:Array.from({length:10},()=>({text:'x'.repeat(10000),side:'gov'}))};
 const streamed=await post(base,{...huge,stream:true});assert.equal(streamed.status,400);assert.match((await streamed.json()).error,/context/);
 const coached=await (await post(base,{...huge,mode:'coach'})).json();assert.equal(coached.qualitativeAvailable,false);assert.match(coached.error,/context/);assert.equal(coached.metrics.words,10);assert.equal(bodies.length,1);
});
test('coach requests structured evidence format only for coach, validates HTTP output even with stream flag',async t=>{
 const bodies=[];
 const model=createModel({fetchImpl:async(url,options)=>{
  if(url.endsWith('/api/tags'))return Response.json({models:[localTag]});
  if(url.endsWith('/api/show'))return Response.json(localShow);
  bodies.push(JSON.parse(options.body));
  return Response.json({message:{content:JSON.stringify({findings:[{focus:'weighing',entry:0}]})}});
 }});
 const base=await listen(createServer({model,speech:null}),t);
 const report=await (await post(base,{...input,mode:'coach',stream:true,transcript:[{text:'Transit helps.',side:'gov',duration:2}]})).json();
 assert.equal(report.qualitativeAvailable,true);assert.equal(report.metrics.wordsPerMinute,60);
 assert.match(report.text,/Review question:/);assert.equal(bodies[0].stream,false);
 assert.equal(bodies[0].format?.additionalProperties,false);
 assert.deepEqual(bodies[0].format?.properties.findings.items.required,['focus','entry']);
 await post(base,input);assert.equal(bodies[1].format,undefined);
});
test('coach HTTP never forwards unsupported free prose or invents metrics',async t=>{
 const base=await listen(createServer({model:{generate:async()=> 'The delivery is unclear.'},speech:null}),t);
 const response=await post(base,{...input,mode:'coach',stream:true,transcript:[{text:'Transit helps.',side:'gov'}]});
 assert.equal(response.status,200);const report=await response.json();
 assert.equal(report.qualitativeAvailable,false);assert.equal(report.metrics.words,2);assert.equal(report.metrics.wordsPerMinute,null);assert.equal(report.metrics.pauses,null);
 assert.ok(!JSON.stringify(report).includes('delivery is unclear'));assert.match(report.error,/evidence format/);
});

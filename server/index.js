import http from 'node:http';
import { once } from 'node:events';
import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createModel } from './model.js';
import { validateInput } from './prompts.js';
import { coach } from './coaching.js';
const PUBLIC=fileURLToPath(new URL('../public/',import.meta.url));
const MAX_BODY=256*1024;
const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.ico':'image/x-icon','.json':'application/json'};
const unavailableSpeech={available:false,mode:'unavailable',error:'Local speech adapter is not installed. Typed input remains available.'};
function json(res,status,data){if(!res.destroyed&&!res.writableEnded){res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(JSON.stringify(data));}}
function trustedRequest(req){
 const port=req.socket.localPort;
 const hosts=new Set([`127.0.0.1:${port}`,`localhost:${port}`,...(port===80?['127.0.0.1','localhost']:[])]);
 if(!hosts.has(req.headers.host))return false;
 if(req.headers['sec-fetch-site']==='cross-site')return false;
 if(req.headers.origin!==undefined && req.headers.origin!==`http://${req.headers.host}`)return false;
 return true;
}
async function bodyJSON(req){
 if(!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type']??''))throw Object.assign(Error('Expected application/json'),{statusCode:400});
 if(Number(req.headers['content-length'])>MAX_BODY)throw Object.assign(Error('Request body too large'),{statusCode:413});
 let size=0;const chunks=[];
 for await(const chunk of req.iterator({destroyOnReturn:false})){size+=chunk.length;if(size>MAX_BODY)throw Object.assign(Error('Request body too large'),{statusCode:413});chunks.push(chunk);}
 try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw Object.assign(Error('Invalid JSON'),{statusCode:400});}
}
async function loadSpeech(){
 try{return await import('./speech.js');}catch{return null;}
}
async function staticFile(req,res,pathname){
 let decoded;
 try{decoded=decodeURIComponent(pathname);}catch{json(res,400,{error:'Invalid path'});return;}
 if(decoded.includes('\0')||decoded.includes('\\')||decoded.split('/').some(piece=>piece.startsWith('.'))){json(res,404,{error:'Not found'});return;}
 const candidate=path.resolve(PUBLIC,`.${decoded==='/'?'/index.html':decoded}`);
 try{
  const root=await realpath(PUBLIC);const target=await realpath(candidate);
  if(!target.startsWith(root+path.sep)||!(await stat(target)).isFile()||!MIME[path.extname(target)])throw Error('Not public');
  const bytes=await readFile(target);res.writeHead(200,{'content-type':MIME[path.extname(target)],'cache-control':'no-cache'});res.end(req.method==='HEAD'?undefined:bytes);
 }catch{json(res,404,{error:'Not found'});}
}
async function streamResponse(res, input, model, signal) {
 let text = '';
 try {
  for await (const delta of model.stream(input, { signal })) {
   signal.throwIfAborted();
   if (typeof delta !== 'string' || text.length + delta.length > 1024 * 1024) throw Error('Invalid stream output');
   if (!res.headersSent) res.writeHead(200, {'content-type':'application/x-ndjson; charset=utf-8','cache-control':'no-store'});
   text += delta;
   if (!res.write(JSON.stringify({delta}) + '\n')) await once(res, 'drain', {signal});
  }
  if (!text.trim()) throw Error('Empty stream');
  res.end(JSON.stringify({done:true,text}) + '\n');
 } catch (error) {
  if (signal.aborted || error.name === 'AbortError') throw error;
  const message = 'Local inference unavailable or interrupted. Retry with the selected installed model.';
  if (res.headersSent) res.end(JSON.stringify({error:message,done:true}) + '\n');
  else json(res,error.statusCode ?? 503,{error:error.statusCode ? error.message : message});
 }
}

export function createServer({model=createModel(),speech}={}) {
 const speechPromise=(speech===undefined?loadSpeech():Promise.resolve(speech)).then(module=>module?.createSpeechAdapter?module.createSpeechAdapter():module);
 const server=http.createServer(async(req,res)=>{
  res.setHeader('x-content-type-options','nosniff');
  res.setHeader('referrer-policy','no-referrer');
  res.setHeader('content-security-policy',"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; media-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
  if(!trustedRequest(req)){json(res,403,{error:'Only same-origin localhost requests are allowed'});return;}
  const controller=new AbortController();
  const cancel=()=>controller.abort(new DOMException('Client disconnected','AbortError'));
  req.on('aborted',cancel);res.on('close',()=>{if(!res.writableEnded)cancel();});
  try{
   const url=new URL(req.url,'http://127.0.0.1');const adapter=await speechPromise;
   if(req.method==='GET'&&url.pathname==='/api/status'){
    let speechStatus=unavailableSpeech;
    if(adapter?.status)try{speechStatus=await adapter.status({signal:controller.signal});}catch{speechStatus={...unavailableSpeech,error:'Local speech capability probe failed'};}
    try{const models=await model.status({signal:controller.signal});json(res,200,{ok:models.length>0,models,...(!models.length?{error:'No local Ollama models installed'}:{}),speech:speechStatus});}
    catch{json(res,200,{ok:false,models:[],error:'Local Ollama unavailable. Start Ollama and install a local model.',speech:speechStatus});}
   }else if(req.method==='POST'&&url.pathname==='/api/generate'){
    const input=validateInput(await bodyJSON(req));
    if(input.stream && input.mode !== 'coach') {
     await streamResponse(res, input, model, controller.signal);
    } else {
     const result=input.mode==='coach'?await coach(input,model,{signal:controller.signal}):{text:await model.generate(input,{signal:controller.signal})};
     json(res,200,result);
    }
   }else if(url.pathname.startsWith('/api/speech/')){
    if(adapter?.handle){const handled=await adapter.handle(req,res);if(!handled&&!res.writableEnded)json(res,404,{error:'Unknown speech route'});}
    else json(res,503,{error:unavailableSpeech.error});
   }else if(url.pathname.startsWith('/api/'))json(res,404,{error:'Unknown API route'});
   else if(['GET','HEAD'].includes(req.method))await staticFile(req,res,url.pathname);
   else json(res,405,{error:'Method not allowed'});
  }catch(error){
   if(controller.signal.aborted||error.name==='AbortError'){if(!res.destroyed)res.end();return;}
   json(res,error.statusCode??503,{error:error.statusCode?error.message:'Local inference unavailable. Check Ollama and selected model, then retry.'});
  }
 });
 server.on('close',()=>{void speechPromise.then(adapter=>adapter?.close?.());});
 return server;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const port=Number(process.env.PORT??3210);
 if(!Number.isInteger(port)||port<1||port>65535)throw Error('Invalid PORT');
 createServer().listen(port,'127.0.0.1',()=>console.log(`ParliBot: http://127.0.0.1:${port}`));
}

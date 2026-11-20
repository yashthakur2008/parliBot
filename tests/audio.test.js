import test from 'node:test';
import assert from 'node:assert/strict';
import { VoiceController } from '../public/audio.js';
import { createSpeechAdapter } from '../server/speech.js';

// Browser APIs are replaced only at the transport boundary; all controller logic is real.
function install(t){
 const old={}; const calls=[];
 class Events { static current; constructor(){Events.current=this;queueMicrotask(()=>this.onopen?.());} close(){this.closed=true;} emit(data){this.onmessage?.({data:JSON.stringify(data)});} }
 class Utterance {constructor(text){this.text=text;}}
 const synth={getVoices:()=>[{localService:true,lang:'en-US',name:'Local test voice'}],items:[],speak(u){this.items.push(u);u.onstart?.();},cancel(){calls.push('cancel');},pause(){calls.push('pause');},resume(){calls.push('resume');}};
 for(const [k,v] of Object.entries({EventSource:Events,SpeechSynthesisUtterance:Utterance,speechSynthesis:synth,fetch:async(url)=>{calls.push(url);return {ok:true,json:async()=>({ok:true})};}})){old[k]=globalThis[k];globalThis[k]=v;}
 t.after(()=>{for(const [k,v] of Object.entries(old)) {if(v===undefined)delete globalThis[k];else globalThis[k]=v;}});
 return {calls,Events,synth};
}
test('local transcript IDs deduplicate but repeated words in new segments survive',async t=>{
 const e=install(t), output=[]; const v=new VoiceController({onTranscript:x=>output.push(x)});
 await v.start({mode:'local'}); const event={type:'transcript',id:'1',text:'yes',final:true};
 e.Events.current.emit(event);e.Events.current.emit(event);e.Events.current.emit({...event,id:'2'});
 assert.equal(output.length,2);v.stop();
});
test('synthesis stops capture, gates late transcripts and queues short segments',async t=>{
 const e=install(t), output=[];const v=new VoiceController({onTranscript:x=>output.push(x)});
 await v.start({mode:'local'});const stream=e.Events.current;
 v.speak('First sentence. Second sentence.');
 stream.emit({type:'transcript',id:'late',text:'AI audio',final:true});
 assert.equal(output.length,0);assert.ok(e.calls.includes('/api/speech/stop'));
 assert.equal(e.synth.items.length,1);e.synth.items[0].onend();assert.equal(e.synth.items.length,2);
 v.pauseSpeech();v.resumeSpeech();v.stop();assert.ok(e.calls.includes('pause'));assert.ok(e.calls.includes('resume'));
 const count=e.synth.items.length;e.synth.items.at(-1).onend();assert.equal(e.synth.items.length,count);
});
test('unsupported browser recognition is explicit and does not silently switch mode',async t=>{
 const e=install(t); const v=new VoiceController({});
 await assert.rejects(v.start({mode:'browser'}),/browser|recognition/i);
 assert.equal(e.calls.filter(x=>x==='/api/speech/start').length,0);
});
test('missing helper status is honest and probe never starts recording',async()=>{
 const adapter=createSpeechAdapter({helperPath:'/does/not/exist'});
 const status=await adapter.status();assert.equal(status.available,false);assert.equal(status.mode,'local');assert.match(status.error,/setup|helper/i);adapter.close();
});

test('activity fires once and levels are clamped; stopped streams cannot emit',async t=>{
 const e=install(t);let activity=0;const levels=[];
 const v=new VoiceController({onActivity:()=>activity++,onLevel:x=>levels.push(x)});
 await v.start({mode:'local'}); const stream=e.Events.current;
 stream.emit({type:'activity'});stream.emit({type:'activity'});stream.emit({type:'level',level:3});
 assert.equal(activity,1);assert.equal(levels.at(-1),1);v.stop();stream.emit({type:'activity'});assert.equal(activity,1);
});
test('replace speech suppresses stale completions',t=>{
 const e=install(t);let oldEnded=0,newEnded=0;
 const v=new VoiceController();v.speak('Old.',{onEnd:()=>oldEnded++});const old=e.synth.items[0];
 v.speak('New.',{onEnd:()=>newEnded++});old.onend();assert.equal(oldEnded,0);
 e.synth.items[1].onend();assert.equal(newEnded,1);v.stop();
});
test('server rejects start without SSE and serves stop idempotently without capture',async t=>{
 const {createServer}=await import('node:http');
 const adapter=createSpeechAdapter({helperPath:'/does/not/exist'});
 const server=createServer(async(req,res)=>{if(!await adapter.handle(req,res)){res.writeHead(404);res.end();}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(()=>{adapter.close();server.closeAllConnections();server.close();});
 const base=`http://127.0.0.1:${server.address().port}`;
 assert.equal((await fetch(`${base}/api/speech/start`,{method:'POST'})).status,503);
 assert.equal((await fetch(`${base}/api/speech/start`)).status,405);
 assert.equal((await fetch(`${base}/api/speech/stop`,{method:'POST'})).status,200);
 assert.equal((await fetch(`${base}/other`)).status,404);
 const controller=new AbortController();
 const stream=await fetch(`${base}/api/speech/events`,{signal:controller.signal});
 assert.match(stream.headers.get('content-type'),/event-stream/);
 assert.equal((await fetch(`${base}/api/speech/events`)).status,409);
 controller.abort();
});

test('closing SSE terminates the synthetic helper process without microphone access',async t=>{
 const {createServer}=await import('node:http');
 const {mkdtemp,writeFile,readFile,rm}=await import('node:fs/promises');
 const {tmpdir}=await import('node:os');
 const {join}=await import('node:path');
 const folder=await mkdtemp(join(process.env.JCODE_SCRATCH_DIR||tmpdir(),'parlibot-voice-test-'));
 const helper=join(folder,'helper');const stopped=join(folder,'stopped');
 await writeFile(helper,`#!${process.execPath}\nif(process.argv.includes('--probe')){console.log(JSON.stringify({supportsOnDeviceRecognition:true}));process.exit(0)}\nprocess.on('SIGTERM',async()=>{await (await import('node:fs/promises')).writeFile(${JSON.stringify(stopped)},'stopped');process.exit(0)});\nconsole.log(JSON.stringify({type:'status',state:'listening',message:'synthetic helper'}));\nsetInterval(()=>{},1000);\n`,{mode:0o755});
 const adapter=createSpeechAdapter({helperPath:helper});
 const server=createServer(async(req,res)=>{await adapter.handle(req,res);});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(async()=>{adapter.close();server.closeAllConnections();server.close();await rm(folder,{recursive:true,force:true});});
 const base=`http://127.0.0.1:${server.address().port}`;
 const controller=new AbortController();
 const response=await fetch(`${base}/api/speech/events`,{signal:controller.signal});
 const reader=response.body.getReader();
 assert.equal((await fetch(`${base}/api/speech/start`,{method:'POST'})).status,200);
 let text='';
 while(!text.includes('synthetic helper')){const {value}=await reader.read();text+=new TextDecoder().decode(value);}
 controller.abort();
 await assert.doesNotReject(async()=>{
   const deadline=Date.now()+3000;
   while(Date.now()<deadline){try{assert.equal(await readFile(stopped,'utf8'),'stopped');return;}catch{await new Promise(resolve=>setTimeout(resolve,20));}}
   assert.fail('SSE disconnect did not terminate helper');
 });
});

test('unavailable synthesis rejects without reporting unsaid speech complete',async t=>{
 install(t);delete globalThis.speechSynthesis;let ended=0;
 const v=new VoiceController();
 await assert.rejects(Promise.resolve(v.speak('Never spoken.',{onEnd:()=>ended++})),/unavailable/i);
 assert.equal(ended,0);
});
test('playback failure rejects and never completes or advances queued segments',async t=>{
 const e=install(t);let ended=0;const v=new VoiceController();
 const result=v.speak('First. Second.',{onEnd:()=>ended++});
 const rejection=assert.rejects(Promise.resolve(result),/synthesis|playback/i);
 e.synth.items[0].onerror({error:'audio-busy'});await rejection;
 assert.equal(ended,0);assert.equal(e.synth.items.length,1);
});
test('synthesis cancellation settles Promise without completion callbacks',async t=>{
 const e=install(t);let ended=0;const v=new VoiceController();
 const result=v.speak('Cancel me.',{onEnd:()=>ended++});
 assert.equal(typeof result?.then,'function');v.cancelSpeech();await result;
 e.synth.items[0].onend();assert.equal(ended,0);
});
test('vendor-only voices reject rather than defaulting to a remote voice',async t=>{
 const e=install(t);t.mock.timers.enable({apis:['setTimeout','setInterval']});e.synth.getVoices=()=>[{localService:false,lang:'en-US'}];
 const v=new VoiceController();let ended=0;
 const rejection=assert.rejects(Promise.resolve(v.speak('Private text.',{onEnd:()=>ended++})),/local|installed/i);
 t.mock.timers.tick(8000);await rejection;
 assert.equal(e.synth.items.length,0);assert.equal(ended,0);
});

test('voiceschanged can provide a local voice before playback begins',async t=>{
 const e=install(t);let voices=[],handler,removed=false;
 e.synth.getVoices=()=>voices;
 e.synth.addEventListener=(name,callback)=>{assert.equal(name,'voiceschanged');handler=callback;};
 e.synth.removeEventListener=(name,callback)=>{if(callback===handler)removed=true;};
 const v=new VoiceController();let ended=0;
 const result=v.speak('Loaded locally.',{onEnd:()=>ended++});
 assert.equal(e.synth.items.length,0);
 const local={localService:true,lang:'en-GB'};voices=[local];handler();
 assert.equal(e.synth.items[0].voice,local);assert.equal(removed,true);
 e.synth.items[0].onend();await result;assert.equal(ended,1);
});
test('cancelling while voices load prevents delayed playback and resolves safely',async t=>{
 const e=install(t);let handler; e.synth.getVoices=()=>[];
 e.synth.addEventListener=(_,callback)=>{handler=callback;};
 const v=new VoiceController();let ended=0;const result=v.speak('Never speak.',{onEnd:()=>ended++});
 v.cancelSpeech();await result;
 e.synth.getVoices=()=>[{localService:true,lang:'en-US'}];handler();
 assert.equal(e.synth.items.length,0);assert.equal(ended,0);
});

test('restart waits for pending local stop so an old stop cannot kill the new capture',async t=>{
 const e=install(t);const v=new VoiceController();await v.start({mode:'local'});
 const originalFetch=globalThis.fetch;let release;
 globalThis.fetch=(url,options)=>url==='/api/speech/stop'?new Promise(resolve=>{release=()=>resolve({ok:true});}):originalFetch(url,options);
 v.stopCapture();const restarting=v.start({mode:'local'});
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(e.calls.filter(url=>url==='/api/speech/start').length,1);
 release();await restarting;
 assert.equal(e.calls.filter(url=>url==='/api/speech/start').length,2);
 globalThis.fetch=originalFetch;v.stop();
});

test('partial hypotheses preview live without deduplicating the eventual final',async t=>{
 const e=install(t),output=[];const v=new VoiceController({onTranscript:x=>output.push(x)});
 await v.start({mode:'local'});
 const stream=e.Events.current;
 stream.emit({type:'transcript',id:'segment1',text:'We should',final:false});
 stream.emit({type:'transcript',id:'segment1',text:'We should act',final:false});
 stream.emit({type:'transcript',id:'segment1',text:'We should act.',final:true});
 stream.emit({type:'transcript',id:'segment1',text:'We should act.',final:true});
 assert.deepEqual(output,[{text:'We should',final:false},{text:'We should act',final:false},{text:'We should act.',final:true}]);
 v.stop();stream.emit({type:'transcript',id:'late',text:'Late partial',final:false});assert.equal(output.length,3);
});

test('constructor warms synthesis voice enumeration without playback or microphone access',t=>{
 const e=install(t);let queries=0;e.synth.getVoices=()=>{queries++;return [];};
 new VoiceController();assert.equal(queries,1);assert.equal(e.synth.items.length,0);
 assert.equal(e.calls.length,0);
});
test('cold voices arriving after one second are discovered even without voiceschanged',async t=>{
 const e=install(t);t.mock.timers.enable({apis:['setTimeout','setInterval']});
 let voices=[];e.synth.getVoices=()=>voices;
 const v=new VoiceController();let ended=0;
 const result=v.speak('Cold local voice.',{onEnd:()=>ended++});
 // Attach immediately so a premature rejection is observed as a test assertion.
 let failure;const settled=result.catch(error=>{failure=error;});
 t.mock.timers.tick(1500);
 voices=[{localService:true,lang:'en-US'}];t.mock.timers.tick(250);
 await Promise.resolve();
 assert.equal(failure,undefined);assert.equal(e.synth.items.length,1);
 e.synth.items[0].onend();await settled;assert.equal(ended,1);
});

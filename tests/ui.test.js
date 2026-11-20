import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
const read = path => existsSync(path) ? readFileSync(path,'utf8') : '';
test('setup provides four levels, editable six durations and all workspace stages',()=>{
 const html=read('public/index.html');
 for(const id of ['setup','prep','round','report','resolution','model','prep-minutes','duration-0','duration-1','duration-2','duration-3','duration-4','duration-5','private-notes','transcript','coach-output']) assert.ok(html.includes(`id="${id}"`),id);
 for(const level of ['easy','medium','hard','champion']) assert.ok(html.includes(`value="${level}"`),level);
});
test('voice and manual flow controls are explicit and accessible',()=>{
 const html=read('public/index.html');
 for(const id of ['start-prep','skip-prep','roadmap','arm','manual-start','end-speech','next-speech','end-round','stop','mic-test','mic-start','mic-stop','typed-form','accept-point','decline-point','point-response','end-point','review','export','browser-consent']) assert.ok(html.includes(`id="${id}"`),id);
 assert.match(html,/vendor.*remotely/is);
});
test('no unsafe HTML insertion or remote assets and clock contract is used',()=>{
 const src=read('public/app.js')+read('public/views.js');
 assert.ok(src.length>100);
 assert.doesNotMatch(src,/\.innerHTML\s*=|insertAdjacentHTML|document\.write/);
 assert.match(src,/clock\(state,\s*now\)/);
 assert.doesNotMatch(read('public/index.html'),/https?:\/\//);
});
test('request and export helpers isolate private notes and normalize public transcript',async()=>{
 assert.ok(existsSync('public/views.js'),'views module exists');
 const {modelRequest,sessionExport,prepMilestones}=await import('../public/views.js');
 const state={config:{resolution:'R',side:'gov',difficulty:'hard',judge:'flow',model:'local',privateNotes:'SECRET'},speechIndex:2,transcript:[{text:'<img onerror=x>',speaker:'A',side:'gov',at:2,duration:3,privateNotes:'SECRET'}],events:[]};
 const request=modelRequest(state,'speech');
 assert.equal(request.mode,'speech');assert.equal(request.speechIndex,2);
 assert.ok(!JSON.stringify(request).includes('SECRET'));
 assert.equal(request.transcript[0].text,'<img onerror=x>');
 assert.equal(JSON.parse(sessionExport(state,'feedback')).version,1);
 assert.equal(prepMilestones(600).at(-1).end,600);
});
test('request gate aborts all work and rejects stale responses',async()=>{
 const {createRequestGate}=await import('../public/views.js');
 const gate=createRequestGate(); const first=gate.begin('speech');
 assert.equal(first.current(),true);
 const second=gate.begin('speech');assert.equal(first.signal.aborted,true);assert.equal(first.current(),false);
 const coach=gate.begin('coach');gate.abort();
 assert.equal(second.signal.aborted,true);assert.equal(coach.current(),false);
});
test('safe text renderer never interprets HTML',async()=>{
 const {setText}=await import('../public/views.js'); const node={textContent:''};
 setText(node,'<script>alert(1)</script>');assert.equal(node.textContent,'<script>alert(1)</script>');
});
test('stream parser preserves UTF-8 deltas and rejects terminal model errors',async()=>{
 const {readModelStream,extractSentences}=await import('../public/views.js');
 const encoder=new TextEncoder();const bytes=encoder.encode('{"delta":"Café. "}\n{"delta":"Next"}\n{"done":true,"text":"Café. Next"}\n');
 const response={body:new ReadableStream({start(c){for(let i=0;i<bytes.length;i+=3)c.enqueue(bytes.slice(i,i+3));c.close();}})};
 let received='';const result=await readModelStream(response,d=>{received+=d});
 assert.equal(received,'Café. Next');assert.equal(result.text,received);
 assert.deepEqual(extractSentences('First sentence. Still thinking'),{sentences:['First sentence.'],rest:' Still thinking'});
 assert.deepEqual(extractSentences('Final thought',true),{sentences:['Final thought'],rest:''});
 const failed={body:new ReadableStream({start(c){c.enqueue(encoder.encode('{"error":"offline","done":true}\n'));c.close();}})};
 await assert.rejects(readModelStream(failed,()=>{}),/offline/);
});
test('point policy accepts first request and can decline later competitive POIs',async()=>{
 const {recognizePoint}=await import('../public/views.js');
 assert.equal(recognizePoint('hard',1,'poi'),true);
 assert.equal(recognizePoint('hard',2,'poi'),false);
 assert.equal(recognizePoint('easy',2,'poi'),true);
 assert.equal(recognizePoint('champion',2,'poo'),true);
});

// A deliberately small DOM adapter exercises the actual app module, not a copy of
// its state machine. This is synthetic wiring coverage, not browser acceptance.
async function exerciseWorkspace(race = 'normal') {
 class Node {
  constructor(tag='div'){this.tagName=tag;this.children=[];this.listeners={};this.dataset={};this.value='';this.textContent='';this.hidden=false;this.disabled=false;this.checked=false;this.scrollHeight=0;this.scrollTop=0;this.clientHeight=500;this.classList={toggle(){}};}
  append(...nodes){this.children.push(...nodes);}
  replaceChildren(...nodes){this.children=[...nodes];}
  addEventListener(type,fn){(this.listeners[type]??=[]).push(fn);}
  async fire(type){for(const fn of this.listeners[type]||[])await fn({preventDefault(){}});}
  setAttribute(name,value){this[name]=value;}
  removeAttribute(name){delete this[name];}
  get options(){return this.children;}
  get selectedOptions(){return [{textContent:'Flow · technical argument comparison'}];}
  querySelector(){return this.button??=new Node('button');}
  reportValidity(){return true;}
  click(){}
 }
 const nodes=new Map();const html=read('public/index.html');
 for(const match of html.matchAll(/<([a-z][a-z0-9]*)\b([^>]*\bid="([^"]+)"[^>]*)>/g)){
  const node=new Node(match[1]);node.id=match[3];node.value=match[2].match(/value="([^"]*)"/)?.[1]||'';node.hidden=/\bhidden\b/.test(match[2]);nodes.set(node.id,node);
 }
 nodes.get('resolution').value='A motion';nodes.get('side').value='gov';nodes.get('voice-mode').value='local';
 const steps=['setup','prep','round','report'].map(step=>{const n=new Node();n.dataset.step=step;return n;});
 const document={getElementById:id=>nodes.get(id),createElement:tag=>new Node(tag),querySelector:()=>({value:'medium'}),querySelectorAll:selector=>selector==='[data-step]'?steps:selector==='#milestones li'?nodes.get('milestones').children:selector==='#speech-track li'?nodes.get('speech-track').children:[]};
 const saved={};for(const key of ['document','window','fetch','setInterval','performance','speechSynthesis','SpeechSynthesisUtterance','SpeechRecognition','EventSource','setTimeout'])saved[key]=Object.getOwnPropertyDescriptor(globalThis,key);
 let tick,ms=1000,pending=false,pendingSignal,requests=[],recognizers=[],streams=[],startupTimers=[],utterances=[],resolveAnswer;
 const holdSpeech = race === 'point';
 Object.defineProperty(globalThis,'EventSource',{configurable:true,value:class{constructor(){this.closed=false;streams.push(this);}close(){this.closed=true;}}});
 Object.defineProperty(globalThis,'setTimeout',{configurable:true,value:(fn,delay,...args)=>{if(delay===5000){startupTimers.push(fn);return -1;}return saved.setTimeout.value(fn,delay,...args);}});
 Object.defineProperty(globalThis,'SpeechRecognition',{configurable:true,value:class{constructor(){recognizers.push(this);}start(){}abort(){}}});
 Object.defineProperty(globalThis,'SpeechSynthesisUtterance',{configurable:true,value:class{constructor(text){this.text=text;}}});
 Object.defineProperty(globalThis,'speechSynthesis',{configurable:true,value:{getVoices:()=>[{localService:true,lang:'en-US'}],cancel(){},pause(){},resume(){},speak(utterance){queueMicrotask(()=>{utterance.onstart?.();if(holdSpeech)utterances.push(utterance);else utterance.onend?.();});}}});
 Object.defineProperty(globalThis,'document',{configurable:true,value:document});
 Object.defineProperty(globalThis,'window',{configurable:true,value:{scrollTo(){},addEventListener(){},confirm(){return true;}}});
 Object.defineProperty(globalThis,'performance',{configurable:true,value:{now:()=>ms}});
 Object.defineProperty(globalThis,'setInterval',{configurable:true,value:fn=>{tick=fn;return 1;}});
 Object.defineProperty(globalThis,'fetch',{configurable:true,value:async(url,options={})=>{
  if(url==='/api/status')return {json:async()=>({ok:true,models:[{name:'test-local'}]})};
  if(url.startsWith('/api/speech/'))return {ok:true,json:async()=>({ok:true})};
  const body=JSON.parse(options.body);requests.push(body);
  if(pending){pendingSignal=options.signal;return new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError'))));}
  if(body.mode==='answer' && race==='point')return new Promise(resolve=>{resolveAnswer=()=>resolve({ok:true,json:async()=>({text:'Answer to the point.'})});});
  if(body.mode==='answer')return {ok:true,json:async()=>({text:'Answer to the point.'})};
  if(body.mode==='poi')return {ok:true,json:async()=>({text:'NO_POINT'})};
  if(body.mode==='coach')return {ok:true,json:async()=>({text:'Grounded feedback',metrics:{words:3,wordsPerMinute:null,speakingSeconds:0}})};
  return {ok:true,headers:{get:()=> 'application/x-ndjson'},body:new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('{"delta":"An opposing argument. "}\n{"done":true,"text":"An opposing argument. "}\n'));c.close();}})};
 }});
 const flush=()=>new Promise(resolve=>setImmediate(resolve));
 const click=async id=>{await nodes.get(id).fire('click');await flush();};
 try{
  await import(`../public/app.js?ui-contract=${Date.now()}-${race}`);await flush();
  nodes.get('model').value='test-local';nodes.get('private-notes').value='PRIVATE_SECRET';
  if(race==='point')nodes.get('side').value='opp';
  await nodes.get('setup-form').fire('submit');assert.equal(nodes.get('prep').hidden,false);
  await click('skip-prep');assert.equal(nodes.get('round').hidden,false);
  if(race==='microphone'){
   await click('arm');const firstStart=nodes.get('mic-start').fire('click');await flush();assert.equal(streams.length,1);
   await click('mic-stop');const secondStart=nodes.get('mic-start').fire('click');await flush();assert.equal(streams.length,2);
   streams[1].onopen();await secondStart;await flush();
   streams[1].onmessage({data:JSON.stringify({type:'status',state:'listening',message:'Replacement capture active'})});
   startupTimers[0]();await firstStart;await flush();
   assert.equal(streams[1].closed,false,'obsolete startup timeout must not close replacement capture');
   assert.equal(nodes.get('voice-status').textContent,'Replacement capture active');
   await click('mic-stop');return;
  }
  if(race==='point'){
   await click('ai-speech');assert.equal(utterances.length,1);
   ms+=61000;tick();await click('offer-poi');nodes.get('typed-text').value='First question';await nodes.get('typed-form').fire('submit');await flush();
   assert.equal(nodes.get('offer-poi').disabled,true,'POI disabled while answer inference is pending');
   await click('offer-poi');assert.equal(nodes.get('point-box').hidden,true,'handler must reject a second point while answer is pending');
   resolveAnswer();await flush();assert.equal(utterances.length,2);
   assert.equal(nodes.get('offer-poi').disabled,true,'POI disabled while answer is playing');
   await click('offer-poi');assert.equal(nodes.get('point-box').hidden,true,'handler must reject a second point while answer plays');
   utterances[1].onend();await flush();tick();
   assert.equal(utterances.length,3,'main sentence resumes after answer without stranding busy ownership');
   assert.equal(nodes.get('offer-poi').disabled,false);
   await click('stop');return;
  }

  await click('roadmap');nodes.get('voice-mode').value='browser';nodes.get('browser-consent').checked=true;await click('mic-start');
  recognizers[0].onresult({resultIndex:0,results:[{isFinal:false,0:{transcript:'roadmap words'}}]});
  await click('arm');assert.equal(nodes.get('phase-label').textContent,'ARMED');
  assert.equal(recognizers.length,2,'arming restarts recognition so roadmap activity cannot consume first-word detection');
  recognizers[1].onresult({resultIndex:0,results:[{isFinal:false,0:{transcript:'first real word'}}]});
  assert.equal(nodes.get('phase-label').textContent,'SPEECH IN PROGRESS');await click('mic-stop');
  nodes.get('typed-text').value='<img src=x onerror=alert(1)> a claim';await nodes.get('typed-form').fire('submit');
  assert.equal(nodes.get('phase-label').textContent,'SPEECH IN PROGRESS');
  assert.ok(nodes.get('transcript').children[0].children.some(n=>n.textContent.includes('<img src=x')));
  for(let i=0;i<6;i++){
   if(i>0){await click('next-speech');if([1,3,4].includes(i)){await click('ai-speech');await flush();}else await click('arm');}
   if(i===1 || i===4){
    await click('manual-start');ms+=61000;tick();
    await click(i===1?'offer-poi':'offer-poo');assert.equal(nodes.get('point-box').hidden,false);
    if(i===4)assert.match(nodes.get('phase-label').textContent,/CLOCK PAUSED/);
    nodes.get('typed-text').value=i===1?'What is your warrant?':'That is a new argument.';await nodes.get('typed-form').fire('submit');await flush();
    assert.equal(nodes.get('point-box').hidden,true);assert.ok(requests.some(r=>r.mode==='answer'));
   }
   ms+=1000;tick();await click('end-speech');
  }
  await flush();assert.equal(nodes.get('report').hidden,false);assert.equal(nodes.get('coach-output').textContent,'Grounded feedback');
  assert.equal(requests.filter(r=>r.mode==='speech').length,3);assert.equal(requests.filter(r=>r.mode==='coach').length,1);
  assert.ok(!JSON.stringify(requests).includes('PRIVATE_SECRET'));
  const edit=nodes.get('editable-transcript').children[0].children[0];edit.value='Corrected public claim';await edit.fire('change');await click('review');
  assert.equal(requests.at(-1).transcript[0].text,'Corrected public claim');
  await click('new-round');nodes.get('side').value='opp';await nodes.get('setup-form').fire('submit');await click('skip-prep');
  pending=true;nodes.get('ai-speech').fire('click');await flush();assert.ok(pendingSignal);await click('stop');
  assert.equal(pendingSignal.aborted,true);assert.match(nodes.get('notice').textContent,/Session stopped/);
 }finally{for(const [key,descriptor]of Object.entries(saved)){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}}
}
test('actual app wires six manual speeches, safe typed flow, review and Stop cancellation',()=>exerciseWorkspace());
test('a pending or speaking POI answer serializes subsequent points',()=>exerciseWorkspace('point'));
test('obsolete microphone startup rejection cannot stop replacement capture',()=>exerciseWorkspace('microphone'));
test('partial recognition stays separate text and clears on final confirmation',async()=>{
 const {renderSpeechPreview}=await import('../public/views.js');const node={textContent:'',hidden:true};
 renderSpeechPreview(node,{text:'<img onerror=x> partial',final:false});
 assert.equal(node.hidden,false);assert.match(node.textContent,/<img onerror=x> partial/);
 renderSpeechPreview(node,{text:'committed words',final:true});assert.equal(node.textContent,'');assert.equal(node.hidden,true);
 assert.ok(read('public/index.html').includes('id="speech-preview"'));
});

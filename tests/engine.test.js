import test from 'node:test';
import assert from 'node:assert/strict';
import { createRound, dispatch, clock, pointEligibility, formatTime, SPEECHES, DEFAULT_CONFIG } from '../public/engine.js';
const ready=(config={})=>dispatch(createRound(config),{type:'SKIP_PREP'},0);
const speaking=(config={})=>dispatch(dispatch(ready(config),{type:'ARM_SPEECH'},0),{type:'VOICE_START'},0);
const move=(s,type,now=0,extra={})=>dispatch(s,{type,...extra},now);

test('default order and durations represent CHSSA six speeches',()=>{
 assert.deepEqual(SPEECHES.map(s=>s.id),['PMC','LOC','MGC','MOC','LOR','PMR']);
 assert.deepEqual(DEFAULT_CONFIG.durations,[420,480,480,480,240,300]);
 assert.deepEqual(SPEECHES.map(s=>s.side),['gov','opp','gov','opp','opp','gov']);
});
test('configurable prep expires without auto advancing and tracks overtime',()=>{
 const s=move(createRound({prepSeconds:60}),'START_PREP',1000);
 assert.equal(clock(s,31000).remaining,30);
 const expired=move(s,'TICK',62000);
 assert.equal(expired.phase,'prep'); assert.equal(clock(expired,62000).overtime,1);
 assert.equal(move(expired,'SKIP_PREP',62000).phase,'ready');
});
test('speech clock waits for first word after arming',()=>{
 let s=move(ready(),'ARM_SPEECH',1000);
 assert.equal(clock(s,5000).elapsed,0);
 s=move(s,'VOICE_START',6000);
 assert.equal(s.phase,'speaking'); assert.equal(clock(s,7000).elapsed,1);
 assert.equal(clock(move(s,'VOICE_START',9000),10000).elapsed,4);
});
test('roadmap remains off time up to 15s and overflow starts speech at boundary',()=>{
 let s=move(ready(),'BEGIN_ROADMAP',1000);
 assert.equal(clock(s,11000).remaining,5);
 s=move(s,'TICK',18000);
 assert.equal(s.phase,'speaking'); assert.equal(clock(s,18000).elapsed,2);
 assert.ok(s.events.some(e=>e.type==='ROADMAP_OVERTIME'));
});
test('finishing roadmap arms speech without counting roadmap',()=>{
 let s=move(ready(),'BEGIN_ROADMAP',0);
 s=move(s,'ARM_SPEECH',10000);
 assert.equal(clock(s,20000).elapsed,0);
 s=move(s,'VOICE_START',21000); assert.equal(clock(s,22000).elapsed,1);
});
test('pause and resume excludes paused wall time',()=>{
 let s=move(speaking(),'PAUSE',10000);
 assert.equal(clock(s,50000).elapsed,10); assert.equal(clock(s,50000).running,false);
 s=move(s,'RESUME',60000); assert.equal(clock(s,65000).elapsed,15);
});
test('speech zero is not a cutoff and explicit next advances one slot',()=>{
 let s=speaking({durations:[30,30,30,30,30,30]});
 s=move(s,'TICK',45000); assert.equal(s.phase,'speaking'); assert.equal(clock(s,45000).overtime,15);
 s=move(s,'END_SPEECH',45000); assert.equal(s.phase,'between');
 assert.equal(clock(s,100000).elapsed,45);
 s=move(s,'NEXT_SPEECH',100000); assert.equal(s.speechIndex,1); assert.equal(s.phase,'ready');
 assert.equal(clock(s,110000).elapsed,0);
});
test('POI boundaries are protected and only accepted opponent points enter speech',()=>{
 let s=speaking();
 assert.equal(pointEligibility(s,59000).poi,false);
 assert.equal(pointEligibility(s,60000).poi,true);
 assert.equal(pointEligibility(s,359999).poi,true);
 assert.equal(pointEligibility(s,360000).poi,false);
 s=move(s,'OFFER_POINT',61000,{kind:'poi',by:'gov'}); assert.equal(s.point,null);
 s=move(s,'OFFER_POINT',61000,{kind:'poi',by:'opp'}); assert.equal(s.point.status,'offered');
 s=move(s,'ACCEPT_POINT',62000); assert.equal(s.point.status,'explanation');
 assert.equal(clock(s,65000).elapsed,65);
 s=move(s,'TICK',78000); assert.equal(s.point,null); assert.equal(clock(s,78000).elapsed,78);
});
test('point offers expire after ten seconds and cannot be accepted in protected time',()=>{
 let s=move(speaking(),'OFFER_POINT',70000,{kind:'poi',by:'opp'});
 assert.equal(move(s,'TICK',80000).point,null);
 s=move(speaking(),'OFFER_POINT',359000,{kind:'poi',by:'opp'});
 assert.equal(move(s,'ACCEPT_POINT',360000).point,null);
});
test('POO illegal in constructive and pauses rebuttal for two 15-second stages',()=>{
 let s=speaking();
 assert.equal(move(s,'OFFER_POINT',60000,{kind:'poo',by:'opp'}).point,null);
 for(let i=0;i<4;i++) {s=move(s,'END_SPEECH',0);s=move(s,'NEXT_SPEECH',0);s=move(s,'ARM_SPEECH',0);s=move(s,'VOICE_START',0);}
 assert.equal(s.speechIndex,4); assert.equal(pointEligibility(s,10000).poi,false);
 s=move(s,'OFFER_POINT',10000,{kind:'poo',by:'gov'});
 assert.equal(s.point.status,'explanation'); assert.equal(clock(s,20000).elapsed,10);
 s=move(s,'TICK',25000); assert.equal(s.point.status,'response');
 s=move(s,'TICK',40000); assert.equal(s.point,null); assert.equal(clock(s,45000).elapsed,15);
});
test('late ticks resume POO at scheduled end, not late observation time',()=>{
 let s=speaking();
 for(let i=0;i<4;i++) {s=move(s,'END_SPEECH',0);s=move(s,'NEXT_SPEECH',0);s=move(s,'ARM_SPEECH',0);s=move(s,'VOICE_START',0);}
 s=move(s,'OFFER_POINT',10000,{kind:'poo',by:'gov'});
 s=move(s,'TICK',50000); assert.equal(clock(s,50000).elapsed,20); assert.equal(s.point,null);
});
test('POCs are disabled by default and clearly opt-in',()=>{
 assert.equal(pointEligibility(speaking(),70000).poc,false);
 assert.equal(pointEligibility(speaking({customPOC:true}),70000).poc,true);
});
test('short custom speeches contain no unprotected POI window',()=>{
 assert.equal(pointEligibility(speaking({durations:[60,60,60,60,60,60]}),61000).poi,false);
});
test('end final rebuttal finishes round and stop freezes clock',()=>{
 let s=speaking();
 for(let i=0;i<5;i++) {s=move(s,'END_SPEECH',0);s=move(s,'NEXT_SPEECH',0);s=move(s,'ARM_SPEECH',0);s=move(s,'VOICE_START',0);}
 s=move(s,'END_SPEECH',5000); assert.equal(s.phase,'completed');
 const stopped=move(speaking(),'STOP',3000); assert.equal(clock(stopped,9000).elapsed,3);assert.equal(stopped.phase,'stopped');
});
test('transcripts are immutable, public fields only, and editable after round',()=>{
 const original=speaking();
 let s=move(original,'ADD_TRANSCRIPT',1000,{text:'Our mechanism is credible.',speaker:'Yash',side:'gov',at:1,duration:3,secret:'private'});
 assert.equal(original.transcript.length,0); assert.equal(s.transcript.length,1); assert.equal(s.transcript[0].secret,undefined);
 s=move(s,'END_ROUND',2000); s=move(s,'UPDATE_TRANSCRIPT',3000,{index:0,text:'Corrected transcript.'});
 assert.equal(s.transcript[0].text,'Corrected transcript.');
});
test('invalid configuration cannot corrupt timer arithmetic',()=>{
 for(const bad of [NaN,-1,Infinity,'bad']) assert.throws(()=>createRound({prepSeconds:bad}),/prep/i);
 assert.throws(()=>createRound({durations:[1,2]}),/duration/i);
 assert.throws(()=>createRound({durations:[-1,2,3,4,5,6]}),/duration/i);
 assert.equal(createRound({prepSeconds:0}).config.prepSeconds,0);
});
test('time formatting handles overtime, rounding and invalid values',()=>{
 assert.equal(formatTime(60),'01:00'); assert.equal(formatTime(59.1),'01:00');
 assert.equal(formatTime(-2),'+00:02'); assert.equal(formatTime(NaN),'00:00');
});

test('all six duration slots must be present and valid',()=>{
 assert.throws(()=>createRound({durations:Array(6)}),/duration/i);
 for(let index=0;index<6;index++) {
  const durations=[420,480,480,480,240,300];
  delete durations[index];
  assert.throws(()=>createRound({durations}),/duration/i);
 }
 const durations=[120,180,240,300,360,420];
 const s=createRound({durations});
 assert.deepEqual(s.config.durations,durations);
 assert.notEqual(s.config.durations,durations);
 assert.deepEqual(createRound({durations:JSON.parse(JSON.stringify(durations))}).config.durations,durations);
});

function deepFreeze(value) {
 if(value && typeof value==='object' && !Object.isFrozen(value)) {
  Object.values(value).forEach(deepFreeze);
  Object.freeze(value);
 }
 return value;
}

test('point and transcript transitions preserve deeply frozen prior states',()=>{
 let s=speaking();
 const step=(type,now,extra={})=>{
  const previous=deepFreeze(s);
  const snapshot=structuredClone(previous);
  s=move(previous,type,now,extra);
  assert.notEqual(s,previous);
  assert.deepEqual(previous,snapshot);
 };
 step('OFFER_POINT',61000,{kind:'poi',by:'opp'});
 step('ACCEPT_POINT',62000);
 assert.equal(s.point.status,'explanation');
 step('TICK',77000);
 assert.equal(s.point,null);
 step('ADD_TRANSCRIPT',78000,{text:'Original',side:'gov'});
 step('UPDATE_TRANSCRIPT',79000,{index:0,text:'Corrected'});
 assert.equal(s.transcript[0].text,'Corrected');
 step('PAUSE',80000);
 step('RESUME',90000);
 assert.equal(clock(s,95000).elapsed,85);
 for(let i=0;i<4;i++) {
  step('END_SPEECH',95000); step('NEXT_SPEECH',95000);
  step('ARM_SPEECH',95000); step('VOICE_START',95000);
 }
 step('OFFER_POINT',100000,{kind:'poo',by:'gov'});
 step('TICK',115000);
 assert.equal(s.point.status,'response');
 step('TICK',130000);
 assert.equal(s.point,null);
 assert.equal(clock(s,135000).elapsed,10);
});

test('invalid phase events and unknown types cannot advance or restart speech',()=>{
 const cases=[
  [createRound(),['NEXT_SPEECH','VOICE_START','ARM_SPEECH','END_SPEECH','RESUME']],
  [ready(),['NEXT_SPEECH','VOICE_START','START_PREP','END_SPEECH','RESUME']],
  [speaking(),['NEXT_SPEECH','VOICE_START','START_PREP','ARM_SPEECH','BEGIN_ROADMAP']],
  [move(speaking(),'STOP',1000),['START_PREP','SKIP_PREP','NEXT_SPEECH','VOICE_START','ARM_SPEECH','BEGIN_ROADMAP','RESUME']],
 ];
 for(const [state,types] of cases) {
  deepFreeze(state);
  for(const type of [...types,'UNKNOWN_EVENT']) {
   const next=move(state,type,2000);
   assert.notEqual(next,state);
   assert.deepEqual(next,state,`${state.phase}: ${type}`);
  }
 }
});

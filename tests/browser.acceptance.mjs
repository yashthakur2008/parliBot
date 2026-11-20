// Real browser workflow with explicitly synthetic inference/audio for deterministic timing.
// Run against a live ParliBot server; set PLAYWRIGHT_MODULE if not locally installed.
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: {width:1440,height:1000}, acceptDownloads:true });
const errors=[], requests=[];
page.on('pageerror',e=>errors.push(e.message));
page.on('dialog',dialog=>dialog.accept());
await page.addInitScript(() => {
  let epoch=0;
  Object.defineProperty(window,'SpeechSynthesisUtterance',{value:class { constructor(text){this.text=text;} }});
  Object.defineProperty(window,'speechSynthesis',{value:{
    getVoices:()=>[{name:'Test voice',lang:'en-US',localService:true}],
    speak(u){const e=epoch;queueMicrotask(()=>{if(e===epoch){u.onstart?.();setTimeout(()=>{if(e===epoch)u.onend?.();},100);}});},
    cancel(){epoch++;},pause(){},resume(){},addEventListener(){},removeEventListener(){}
  }});
});
await page.route('**/api/generate',async route=>{
  const input=route.request().postDataJSON(); requests.push(input);
  assert.ok(!JSON.stringify(input).includes('PRIVATE-NOTES-DO-NOT-SEND'));
  let text=input.mode==='speech'?'Our alternative is targeted enforcement. A blanket prohibition sacrifices useful information without resolving the underlying incentive.':input.mode==='poi'?(input.point?.kind==='poo'?'NO_POINT':'What makes your mechanism better than targeted enforcement?'):input.mode==='answer'?'Our alternative addresses the same harm with fewer restrictions.':'Practice review: compare targeted enforcement with the ban. Drill one: explain the causal mechanism. Drill two: answer the alternative. Drill three: weigh the residual harm.';
  const result=input.mode==='coach'?{text,qualitativeAvailable:true,metrics:{words:42,wordsPerMinute:null,speakingSeconds:0,measurementBasis:'Typed test transcript; no measured audio.'}}:{text};
  if(input.stream) await route.fulfill({contentType:'application/x-ndjson',body:JSON.stringify({delta:text})+'\n'+JSON.stringify({done:true,text})+'\n'});
  else await route.fulfill({json:result});
});
const url=process.env.PARLIBOT_URL || 'http://127.0.0.1:3210';
const shotDir=process.env.JCODE_SCRATCH_DIR || './artifacts';await mkdir(shotDir,{recursive:true});
try {
 await page.clock.install();
 await page.goto(url);await page.waitForFunction(()=>document.querySelector('#model').value);
 assert.equal(await page.locator('[name=difficulty]').count(),4);
 await page.locator('#resolution').fill('This House would ban targeted advertising to minors.');
 await page.locator('#prep-minutes').fill('0.5');
 for(let i=0;i<6;i++)await page.locator(`#duration-${i}`).fill('3');
 assert.equal(await page.locator('#format-label').innerText(),'CUSTOM PRACTICE');
 await page.locator('#speaker-1').fill('First partner');await page.locator('#speaker-2').fill('Second partner');
 await page.locator('#start-prep').click();assert.equal(await page.locator('#prep').isVisible(),true);
 await page.locator('#private-notes').fill('PRIVATE-NOTES-DO-NOT-SEND');
 await page.locator('#prep-pause').click();const paused=await page.locator('#prep-clock').innerText();
 await page.clock.runFor(3000);assert.equal(await page.locator('#prep-clock').innerText(),paused);
 await page.locator('#skip-prep').click();assert.equal(await page.locator('#round').isVisible(),true);
 await page.locator('#roadmap').click();await page.clock.runFor(16000);
 assert.match(await page.locator('#phase-label').innerText(),/SPEECH IN PROGRESS/);
 assert.match(await page.locator('#notice').innerText(),/roadmap allowance/);
 await page.clock.runFor(61000);
 await page.locator('#typed-text').fill('We defend a ban because personalization exploits information asymmetry. Platforms infer interests that children cannot evaluate. Removing behavioral targeting reduces the incentive to design manipulative profiles. Contextual advertisements remain available, so businesses retain a route to reach customers. Targeted enforcement alone leaves the harmful incentive intact and requires identifying each individual violation.');
 await page.locator('#typed-form button').click();
 await page.waitForFunction(()=>!document.querySelector('#point-box').hidden);
 await page.locator('#decline-point').click();assert.equal(await page.locator('#point-box').isVisible(),false);
 await page.screenshot({path:`${shotDir}/parlibot-round.png`,fullPage:true});
 await page.clock.runFor(121000);assert.match(await page.locator('#speech-clock').innerText(),/^\+/);
 assert.equal(await page.locator('#end-speech').isVisible(),true);
 await page.locator('#end-speech').click();await page.locator('#next-speech').click();
 await page.locator('#ai-speech').click();await page.waitForFunction(()=>document.querySelector('#transcript').innerText.includes('targeted enforcement') && document.querySelector('#phase-label').innerText.includes('SPEECH'));
 await page.clock.runFor(1000);
 await page.clock.runFor(61000);assert.equal(await page.locator('#offer-poi').isEnabled(),true);
 await page.locator('#offer-poi').click();await page.locator('#typed-text').fill('How would you identify each violation?');await page.locator('#typed-form button').click();
 await page.clock.runFor(16000);
 await page.locator('#end-speech').click();await page.locator('#next-speech').click();
 // Finish remaining four speeches using actual controls. AI generated text remains synthetic.
 for(let i=2;i<6;i++) {
   assert.match(await page.locator('#speech-kicker').innerText(),new RegExp(`SPEECH ${i+1} OF 6`));
   await page.locator('#arm').click();await page.locator('#manual-start').click();
   if(i===2||i===5){await page.locator('#typed-text').fill('The comparative issue is whether enforcement reaches the structural incentive. Our restriction addresses that incentive directly.');await page.locator('#typed-form button').click();}
   if(i===4){assert.equal(await page.locator('#offer-poo').isEnabled(),true);await page.locator('#offer-poo').click();const frozen=await page.locator('#speech-clock').innerText();await page.clock.runFor(10000);assert.equal(await page.locator('#speech-clock').innerText(),frozen);await page.locator('#end-point').click();}
   await page.locator('#end-speech').click();if(i<5)await page.locator('#next-speech').click();
 }
 await page.waitForFunction(()=>document.querySelector('#coach-output').innerText.includes('Practice review:'));
 assert.equal(await page.locator('#report').isVisible(),true);
 const edit=page.locator('#editable-transcript textarea').first();await edit.fill('Corrected: our policy targets behavioral advertising, not contextual advertising.');await edit.blur();
 await page.locator('#review').click();await page.waitForFunction(()=>document.querySelector('#coach-output').innerText.includes('Practice review:'));
 assert.ok(requests.at(-1).transcript[0].text.startsWith('Corrected:'));
 const downloadPromise=page.waitForEvent('download');await page.locator('#export').click();const download=await downloadPromise;const exported=await readFile(await download.path(),'utf8');
 assert.ok(!exported.includes('PRIVATE-NOTES-DO-NOT-SEND'));assert.match(exported,/Corrected:/);
 await page.screenshot({path:`${shotDir}/parlibot-coach.png`,fullPage:true});
 await page.locator('#new-round').click();assert.equal(await page.locator('#setup').isVisible(),true);
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:`${shotDir}/parlibot-mobile.png`,fullPage:true});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'No mobile horizontal overflow');
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({passed:true,checks:['editable times','prep pause','roadmap overflow','typed public flow','AI point decline','speech overtime','streamed AI sentences','human POI','rebuttal POO pause','six speeches','coach','transcript correction','private-note isolation','export','mobile layout'],requests:requests.length,screenshotDirectory:shotDir,limitation:'Inference and speech playback are synthetic adapters. Real model and microphone tests are separate.'},null,2));
} finally { await browser.close(); }

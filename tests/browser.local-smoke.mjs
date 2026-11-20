// Optional real local model + local synthesis smoke. No microphone and muted output.
import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--mute-audio']});
try {
 const page=await browser.newPage(); const errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 await page.goto(process.env.PARLIBOT_URL || 'http://127.0.0.1:3210');
 await page.waitForFunction(()=>document.querySelector('#model').value);
 await page.locator('#side').selectOption('opp');
 await page.locator('#duration-0').fill('0.3');
 assert.equal(await page.locator('#duration-0').evaluate(e=>e.checkValidity()),true);
 await page.locator('#start-prep').click();
 await page.locator('#skip-prep').click();
 console.log('Setup complete. Requesting real AI speech.');
 const start=Date.now();
 await page.locator('#ai-speech').click();
 await page.waitForFunction(()=>document.querySelector('#phase-label').textContent.includes('SPEECH IN PROGRESS'),{},{timeout:30000}).catch(async error=>{ console.log(await page.evaluate(()=>({phase:document.querySelector('#phase-label').textContent,notice:document.querySelector('#notice').textContent,flow:document.querySelector('#transcript').textContent,voice:document.querySelector('#voice-status').textContent})));throw error;});
 const firstSpeechMs=Date.now()-start;
 await page.waitForFunction(()=>document.querySelector('#transcript').textContent.toLowerCase().includes('government'),{},{timeout:120000});
 const transcript=await page.locator('#transcript').innerText();
 assert.ok(transcript.length>30); assert.ok(!transcript.includes('not spoken'));
 await page.locator('#stop').click();
 assert.deepEqual(errors,[]);
 console.log({passed:true,firstSpeechMs,transcript,limitation:'Real model, streaming HTTP, UI and local synthesis callbacks. Muted output. No microphone capture or acoustic assessment.'});
} finally {await browser.close();}

// Optional real local model + local synthesis smoke. No microphone and muted output.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--mute-audio']});
try {
 const page=await browser.newPage(); const errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 await page.goto(process.env.PARLIBOT_URL || 'http://127.0.0.1:3210');
 await page.waitForFunction(()=>document.querySelector('#model').value);
 await page.locator('#resolution').fill('This House would ban targeted advertising to minors.');
 for(let i=0;i<6;i++)await page.locator(`#duration-${i}`).fill('0.3');
 await page.locator('#start-prep').click();
 await page.locator('#private-notes').fill('PRIVATE-REAL-ROUND-NOTES-DO-NOT-EXPORT');
 await page.locator('#skip-prep').click();
 const human=['We defend a ban on behavioral advertising to minors. Contextual advertising remains legal. Profiling creates incentives to exploit children, so removing that revenue reduces harmful targeting.','The opposition must compare alternatives. Enforcement against individual deceptive advertisements leaves the underlying profiling incentive intact. Our narrower ban preserves contextual advertising while protecting minors.','Prefer prevention of profiling over case by case enforcement. The comparative benefit is reducing the incentive itself, while preserving contextual advertising.'];
 for(let i=0;i<6;i++) {
  if([0,2,5].includes(i)) {
   await page.locator('#arm').click();await page.locator('#typed-text').fill(human[[0,2,5].indexOf(i)]);await page.locator('#typed-form button').click();
  } else {
   const count=await page.locator('#transcript .entry-meta').count();
   await page.locator('#ai-speech').click();
   await page.waitForFunction(n=>document.querySelectorAll('#transcript .entry-meta').length>n && document.querySelector('#ai-draft').hidden && !speechSynthesis.speaking,count,{timeout:120000});
   assert.ok(!(await page.locator('#transcript').innerText()).includes('not spoken'));
  }
  console.log(`Completed public speech ${i+1}/6`);
  await page.locator('#end-speech').click();if(i<5)await page.locator('#next-speech').click();
 }
 await page.waitForFunction(()=>document.querySelector('#coach-output').textContent.length>150,{},{timeout:180000});
 const feedback=await page.locator('#coach-output').innerText();
 assert.ok(!/unavailable|could not|failed/i.test(feedback.slice(0,100)),feedback);
 const downloadEvent=page.waitForEvent('download');await page.locator('#export').click();const download=await downloadEvent;
 const exported=await readFile(await download.path(),'utf8');
 const record=JSON.parse(exported);
 assert.equal(record.version,1);
 assert.equal(record.config.resolution,'This House would ban targeted advertising to minors.');
 assert.ok(record.transcript.length>=6);
 assert.ok(record.events.length>0);
 assert.equal(record.feedback.text.trim(),feedback.trim());
 assert.ok(!exported.includes('PRIVATE-REAL-ROUND-NOTES-DO-NOT-EXPORT'));
 await page.locator('#new-round').click();
 assert.equal(await page.locator('#setup').isVisible(),true);
 assert.deepEqual(errors,[]);
 console.log({passed:true,speeches:6,feedback,export:download.suggestedFilename(),limitation:'Real UI, model, HTTP, local synthesis and coach. Human speeches entered through supported typed fallback, audio muted. No microphone or acoustic acceptance.'});
} finally {await browser.close();}

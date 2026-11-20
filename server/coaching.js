import { renderCoach } from './coach-contract.js';
// Transcript durations are seconds of measured speaking, not wall-clock timestamps.
export function deliveryStats(transcript, side) {
 let words=0, timedWords=0, speakingSeconds=0;
 const fillers={um:0,uh:0,erm:0};
 for(const entry of transcript.filter(item=>item.side===side)) {
  const tokens=String(entry.text ?? '').match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu) ?? [];
  words+=tokens.length;
  if(Number.isFinite(entry.duration) && entry.duration>0){speakingSeconds+=entry.duration;timedWords+=tokens.length;}
  for(const token of tokens) if(Object.hasOwn(fillers,token.toLowerCase())) fillers[token.toLowerCase()]++;
 }
 return {side,words,speakingSeconds,timedWords,untimedWords:words-timedWords,wordsPerMinute:speakingSeconds?Math.round(timedWords*6000/speakingSeconds)/100:null,fillers,pauses:null,measurementBasis:'Transcript word count and supplied speaking-duration seconds. WPM uses only timed entries. Fillers are literal transcript occurrences, subject to recognition uncertainty. Pauses, tone, volume and pronunciation are not measured.'};
}
export async function coach(input,model,{signal}={}) {
 const metrics=deliveryStats(input.transcript,input.config.side);
 try { return {text:renderCoach(await model.generate(input,{signal}),input.transcript),metrics,qualitativeAvailable:true}; }
 catch(error){if(signal?.aborted || error.name==='AbortError')throw error;return {text:'Qualitative coaching unavailable. Objective transcript metrics remain available.',metrics,qualitativeAvailable:false,error:error.statusCode === 400 || error.code === 'COACH_FORMAT' ? error.message : 'Local model unavailable. Check Ollama and selected model, then retry.'};}
}

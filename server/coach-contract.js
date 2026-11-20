// Model output selects review targets, never authors assessments. These templates
// are questions, not a claim that a quoted argument has a demonstrated fault.
export const CASE_FOCUSES = {
 burden: ['What burden and definition must this argument satisfy?', 'State the burden and test each definition against the resolution.'],
 evidence: ['What source would verify this assertion, and how current is it?', 'Separate assertions from verified sources and mark unknowns explicitly.'],
 causal_warrant: ['What causal mechanism connects this claim to its impact?', 'Write the missing intermediate causal steps and test an alternative explanation.'],
 solvency: ['How would the proposed actor implement this mechanism?', 'Explain implementation, incentives and one practical obstacle.'],
 clash: ['Which opposing argument does this answer, and with what warrant?', 'Pair an exact opposing claim with a direct warranted response.'],
 weighing: ['How does this impact compare on probability, magnitude and timeframe?', 'Compare both sides on a shared metric and explain why it matters.'],
 organization: ['How does this passage connect to the case thesis in the text?', 'Rewrite the passage as claim, warrant, impact and link to the thesis.'],
 rules: ['Does the public speech sequence establish whether this argument is permitted?', 'Trace the argument to its first constructive appearance before alleging a new rebuttal argument.']
};
export const COACH_FORMAT = {
 type:'object',additionalProperties:false,required:['findings'],properties:{findings:{type:'array',minItems:1,maxItems:6,items:{
  type:'object',additionalProperties:false,required:['focus','entry'],properties:{
   focus:{type:'string',enum:Object.keys(CASE_FOCUSES)},entry:{type:'integer',minimum:0}
  }
 }}}
};
function exactKeys(value,keys) {
 return value && typeof value==='object' && !Array.isArray(value) && Object.keys(value).length===keys.length && keys.every(key=>Object.hasOwn(value,key));
}
export function renderCoach(text,transcript) {
 const invalid=()=>{throw Object.assign(Error('Local coach did not return the required transcript evidence format. No qualitative assessment was shown. Retry or review the transcript manually.'),{code:'COACH_FORMAT'});};
 let data;
 try {data=JSON.parse(text);}catch{invalid();}
 if(!exactKeys(data,['findings']) || !Array.isArray(data.findings) || data.findings.length<1 || data.findings.length>6)invalid();
 for(const item of data.findings) {
  if(!exactKeys(item,['focus','entry']) || typeof item.focus!=='string' || !Object.hasOwn(CASE_FOCUSES,item.focus) || !Number.isInteger(item.entry) || item.entry<0 || !transcript[item.entry]?.text.trim())invalid();
 }
 const lines=['Provisional text-only case review. Model-selected review targets, not findings of faults. Quotes establish only what the transcript contains, not factual accuracy or relevance. Excerpts show the first 240 characters of the selected entry; review the full entry in the transcript. No ballot, readiness verdict or rubric score is established.',
 'Audio delivery is unassessable: tone, confidence, pronunciation, volume and pauses are not measured. Recognition errors may not be delivery faults.'];
 for(const item of data.findings)lines.push(`Entry ${item.entry}. Transcript excerpt (not verified fact): ${JSON.stringify(transcript[item.entry].text.slice(0,240))}\nReview question: ${CASE_FOCUSES[item.focus][0]}`);
 const focuses=[...new Set([...data.findings.map(item=>item.focus),'causal_warrant','clash','weighing'])].slice(0,3);
 lines.push('Three suggested case drills (model order is provisional):',...focuses.map((focus,i)=>`${i+1}. ${CASE_FOCUSES[focus][1]}`),
 'Example revision scaffold, not a factual claim: Our claim is [claim]. This follows because [mechanism and support]. Against [opposing claim], prefer this impact because [comparative reason].');
 return lines.join('\n\n');
}

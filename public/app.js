import {SPEECHES, DEFAULT_CONFIG, createRound, dispatch, clock, pointEligibility, formatTime} from './engine.js';
import {VoiceController} from './audio.js';
import {setText, textElement, modelRequest, prepMilestones, sessionExport, createRequestGate, readModelStream, extractSentences, recognizePoint, renderSpeechPreview} from './views.js';

const $ = id => document.getElementById(id);
const text = (id, value) => setText($(id), value);
const element = (tag, value, cls) => textElement(document, tag, value, cls);
const nowTime = () => performance.now();
const requests = createRequestGate();
let state = createRound(DEFAULT_CONFIG, nowTime());
let view = 'setup', feedback = null, busy = false, reviewing = false, microphone = false, testingMic = false;
let names = ['Speaker one', 'Speaker two'], lastSegmentAt = 0, lastOfferAt = -Infinity, offerBusy = false;
let aiChunks = [], aiChunkActive = false, aiGenerationIndex = -1, synthesisEpoch = 0, generatedPoint = '';
let microphoneEpoch = 0;
let pointReplyBusy = false, pointReplyEpoch = 0, restoreMicAfterPoint = false, humanOffers = 0, renderedTranscript = -1, testTimeout;
const voice = new VoiceController({
  onTranscript({text: value, final}) {
    if (!value?.trim()) return;
    if (!final) {
      if (testingMic) text('mic-preview', `Listening · ${value}`);
      else if (microphone && canHumanSpeak()) renderSpeechPreview($('speech-preview'), {text:value, final:false});
      return;
    }
    renderSpeechPreview($('speech-preview'), {final:true});
    if (testingMic) { text('mic-preview', `Recognized: ${value}`); return; }
    if (!microphone || !canHumanSpeak()) return;
    const now = nowTime();
    if (state.phase === 'armed') send('VOICE_START', {}, now);
    const elapsed = clock(state, now).elapsed;
    const duration = state.point ? 0 : Math.max(0, elapsed - lastSegmentAt);
    lastSegmentAt = elapsed;
    addHumanTranscript(value, duration, now);
  },
  onActivity() { if (microphone && !testingMic && isHumanTurn() && state.phase === 'armed') { send('VOICE_START'); lastSegmentAt = 0; } },
  onLevel(level) { $('mic-level').value = level; },
  onStatus({state: status, message}) {
    text('voice-status', message || status);
    if (['error', 'unavailable', 'denied', 'stopped', 'idle'].includes(status)) { microphone = false; $('mic-stop').disabled = true; }
  }
});

function notice(message = '') { text('notice', message); $('notice').hidden = !message; }
function isHumanTurn() { return SPEECHES[state.speechIndex].side === state.config.side; }
function speakerName(side = SPEECHES[state.speechIndex].side) {
  return side === state.config.side ? names[SPEECHES[state.speechIndex].speaker - 1] : `AI ${side === 'gov' ? 'Government' : 'Opposition'} ${SPEECHES[state.speechIndex].speaker}`;
}
function canHumanSpeak() {
  if (!['armed', 'speaking', 'roadmap'].includes(state.phase)) return false;
  if (!state.point) return isHumanTurn();
  if (state.point.status === 'offered') return isHumanTurn();
  return state.point.status === 'response' ? isHumanTurn() : state.point.by === state.config.side;
}
function send(type, data = {}, now = nowTime()) {
  const previous = state;
  state = dispatch(state, {type, ...data}, now);
  if (previous.phase === 'roadmap' && state.phase === 'speaking') notice('The 15-second roadmap allowance has ended. Your speech clock is now running.');
  if (previous.point && !state.point) {
    generatedPoint = '';
    if (previous.point.kind === 'poo') { pointReplyEpoch++; pointReplyBusy = false; }
    // A POI answer is part of the speaker's own speech, not its 15-second question window.
    if (!pointReplyBusy && previous.point.status !== 'offered') { cancelSynthesis(); if (!isHumanTurn() && state.phase === 'speaking') playNextChunk(); }
    if (isHumanTurn() && restoreMicAfterPoint && state.phase === 'speaking') { restoreMicAfterPoint = false; startMic(false); }
  }
  if (previous.point?.status === 'explanation' && state.point?.status === 'response') {
    if (state.point.by === state.config.side && !isHumanTurn()) answerHumanPoint();
    else if (isHumanTurn()) { cancelSynthesis(); if (restoreMicAfterPoint) { restoreMicAfterPoint = false; startMic(false); } }
  }
  render(now);
}
function showView(next) {
  if (view === next) return;
  view = next;
  for (const id of ['setup','prep','round','report']) $(id).hidden = id !== next;
  document.querySelectorAll('[data-step]').forEach(node => {
    if (node.dataset.step === next) node.setAttribute('aria-current', 'step'); else node.removeAttribute('aria-current');
  });
  window.scrollTo({top: 0, behavior: 'instant'});
}
function configFromForm() {
  return {resolution: $('resolution').value.trim(), side: $('side').value,
    difficulty: document.querySelector('[name="difficulty"]:checked').value,
    judge: $('judge').selectedOptions[0].textContent, model: $('model').value,
    prepSeconds: Number($('prep-minutes').value) * 60,
    durations: SPEECHES.map((_, i) => Number($(`duration-${i}`).value) * 60), customPOC: $('custom-poc').checked};
}
function updateFormat() {
  const custom = $('custom-poc').checked || Number($('prep-minutes').value) !== 20 || SPEECHES.some((s,i) => Number($(`duration-${i}`).value) * 60 !== s.seconds);
  text('format-label', custom ? 'CUSTOM PRACTICE' : 'CHSSA PRESET');
}
async function refreshModels() {
  const job = requests.begin('status'); text('connection', 'Checking local model');
  try {
    const response = await fetch('/api/status', {signal: job.signal});
    const status = await response.json(); if (!job.current()) return;
    const selected = $('model').value;
    $('model').replaceChildren();
    for (const model of status.models || []) {
      const option = element('option', model.name); option.value = model.name; $('model').append(option);
    }
    if (!$('model').options.length) { const option = element('option', 'No local models available'); option.value = ''; $('model').append(option); }
    else if ([...$('model').options].some(o => o.value === selected)) $('model').value = selected;
    const connected = Boolean(status.ok && status.models?.length);
    text('connection', connected ? 'Local model connected' : 'Local model unavailable');
    $('connection').classList.toggle('connected', connected);
    text('model-detail', connected ? `${status.models.length} installed model${status.models.length === 1 ? '' : 's'}. Inference stays on this computer.` : status.error || 'Start Ollama and install a model. Timed and typed practice still work.');
    if (status.speech) text('mic-preview', status.speech.available ? `Local voice available (${status.speech.mode}). Use headphones to avoid feedback.` : status.speech.error || 'Local speech helper is not ready. Typed fallback is available.');
  } catch (error) { if (job.current()) { text('connection', 'Local server unavailable'); text('model-detail', `${error.message}. You can still prepare and use the timers.`); } }
  finally { job.finish(); }
}
async function generate(mode, point, onDelta) {
  const job = requests.begin(mode);
  try {
    const response = await fetch('/api/generate', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({...modelRequest(state, mode, point), ...(onDelta ? {stream:true} : {})}), signal:job.signal});
    const result = response.ok && onDelta && response.headers.get('content-type')?.includes('ndjson')
      ? await readModelStream(response, delta => { if (job.current()) onDelta(delta); })
      : await response.json();
    if (!job.current()) return null;
    if (!response.ok && !(mode === 'coach' && (result.metrics || result.stats))) throw new Error(result.error || `Local inference failed (${response.status}).`);
    return result;
  } catch (error) {
    if (job.current() && error.name !== 'AbortError') throw error;
    return null;
  } finally { job.finish(); }
}
function stopMic() {
  microphoneEpoch++;
  renderSpeechPreview($('speech-preview'), {final:true});
  clearTimeout(testTimeout); microphone = false; testingMic = false; voice.stop();
  $('mic-stop').disabled = true; $('mic-level').value = 0;
}
async function startMic(test = false) {
  if (test && !['setup','prep'].includes(view)) { notice('Test your microphone before the round. During a speech, use Enable mic on your floor.'); return; }
  const mode = $('voice-mode').value;
  if (mode === 'browser' && !$('browser-consent').checked) { notice('Browser recognition may send audio to the browser vendor. Check the explicit consent box first, or choose local recognition.'); return; }
  if (!test && !canHumanSpeak()) { notice('Enable the microphone on your floor or during your accepted point. Use Test mic before a round.'); return; }
  stopMic(); const attempt = microphoneEpoch; testingMic = test; microphone = true; $('mic-stop').disabled = false;
  try {
    await voice.start({mode});
    if (attempt !== microphoneEpoch) return;
    if (!microphone) { voice.stop(); return; }
    lastSegmentAt = clock(state, nowTime()).elapsed;
    if (test) { notice('Microphone test is live for 10 seconds. Test words stay out of the public transcript.'); testTimeout = setTimeout(() => { if (attempt === microphoneEpoch) stopMic(); }, 10000); }
  } catch (error) { if (attempt !== microphoneEpoch) return; stopMic(); notice(`Microphone unavailable: ${error.message}. Typed practice remains available.`); }
}
function cancelSynthesis() { synthesisEpoch++; aiChunkActive = false; voice.cancelSpeech(); }
function stopWork() {
  requests.abort(); busy = false; reviewing = false; offerBusy = false; pointReplyBusy = false; pointReplyEpoch++; restoreMicAfterPoint = false;
  stopMic(); cancelSynthesis();
}
function appendTranscript(value, side, duration = 0, at = nowTime(), speaker = speakerName(side)) {
  send('ADD_TRANSCRIPT', {text:value, speaker, side, at, duration}, at);
}
function addHumanTranscript(value, duration = 0, at = nowTime()) {
  if (!canHumanSpeak()) { notice('The public input is open only on your floor or for an accepted point.'); return; }
  if (state.phase === 'roadmap') { text('mic-preview', `Roadmap (off time, not added to argument flow): ${value}`); return; }
  if (state.phase === 'armed') send('VOICE_START', {}, at);
  appendTranscript(value, state.config.side, duration, at);
  if (state.point && state.point.by === state.config.side && state.point.status !== 'offered') {
    if (state.point.kind === 'poo') send('POINT_RESPONSE');
    answerHumanPoint();
  } else maybeOfferPoint();
}
async function generateSpeech() {
  if (busy || isHumanTurn() || aiGenerationIndex === state.speechIndex || !['ready','armed','speaking'].includes(state.phase)) return;
  if (!state.config.model) { notice('No model is selected. Timed practice is still available. Start another round to select an installed model.'); return; }
  if (state.phase === 'ready') send('ARM_SPEECH');
  const index = state.speechIndex; busy = true; render();
  notice('The local opponent is thinking. Words stream below as they arrive. The timer starts on the first actual spoken word.');
  let buffer = '', received = '';
  const draft = $('ai-draft'); draft.hidden = false; setText(draft, 'Waiting for the first local model token…');
  const enqueue = (delta, final = false) => {
    received += delta; buffer += delta;
    setText(draft, `AI composing · ${received}`);
    const parts = extractSentences(buffer, final); buffer = parts.rest;
    aiChunks.push(...parts.sentences);
    if (parts.sentences.length) { aiGenerationIndex = index; playNextChunk(); }
  };
  try {
    const result = await generate('speech', undefined, delta => {
      if (index === state.speechIndex && ['armed','speaking'].includes(state.phase)) enqueue(delta);
    });
    if (!result || index !== state.speechIndex || !['armed','speaking'].includes(state.phase)) return;
    if (!received && result.text) enqueue(result.text);
    enqueue('', true);
    if (!received.trim()) throw new Error('The model returned no speech. Try again.');
    notice('AI response generated. Speech plays in short segments. Use End speech when ready, never an automatic transition.');
  } catch (error) {
    if (aiGenerationIndex !== index) notice(`${error.message} Your round is intact. Use Generate AI speech to retry.`);
    else notice(`${error.message} Completed sentences are retained. Finish this speech manually rather than replaying a duplicate turn.`);
  } finally { draft.hidden = true; busy = false; render(); }
}
function playNextChunk() {
  if (aiChunkActive || pointReplyBusy || !aiChunks.length || isHumanTurn() || state.point || !['armed','speaking'].includes(state.phase)) return;
  if (state.phase === 'speaking' && !clock(state, nowTime()).running) return;
  stopMic(); aiChunkActive = true;
  const epoch = synthesisEpoch, chunk = aiChunks[0], index = state.speechIndex;
  let start = 0, started = false;
  try {
    const result = voice.speak(chunk, {
      onStart() { if (epoch !== synthesisEpoch) return; started = true; if (state.phase === 'armed') send('VOICE_START'); start = clock(state, nowTime()).elapsed; },
      onEnd() {
        if (epoch !== synthesisEpoch || index !== state.speechIndex) return;
        aiChunkActive = false; aiChunks.shift();
        appendTranscript(chunk, SPEECHES[index].side, started ? Math.max(0, clock(state, nowTime()).elapsed - start) : 0, nowTime(), started ? speakerName() : `${speakerName()} (text fallback, not spoken)`);
        if (aiChunks.length) playNextChunk(); else if (!busy) notice('AI speech complete. The clock stays live until you choose End speech.');
      }
    });
    Promise.resolve(result).catch(error => synthesisFailed(error, epoch));
  } catch (error) { synthesisFailed(error, epoch); }
}
function synthesisFailed(error, epoch) {
  if (epoch !== synthesisEpoch) return;
  aiChunkActive = false;
  const remainder = aiChunks.join(' '); aiChunks = [];
  if (remainder) appendTranscript(remainder, SPEECHES[state.speechIndex].side, 0, nowTime(), `${speakerName()} (text fallback, not spoken)`);
  notice(`Speech playback unavailable: ${error.message}. The generated text is in the flow, labeled not spoken. Start the clock manually if needed.`);
}
async function maybeOfferPoint() {
  const now = nowTime(), eligibility = pointEligibility(state, now);
  const kind = eligibility.poi ? 'poi' : eligibility.poo ? 'poo' : null;
  if (!kind || !isHumanTurn() || !state.config.model || offerBusy || now - lastOfferAt < 45000 || state.transcript.filter(e => e.side === state.config.side).map(e=>e.text).join(' ').split(/\s+/).length < 45) return;
  lastOfferAt = now; offerBusy = true; const index = state.speechIndex;
  const by = state.config.side === 'gov' ? 'opp' : 'gov';
  try {
    const result = await generate('poi', {kind, by});
    if (!result?.text?.trim() || /^NO_POINT[.!]?$/i.test(result.text.trim()) || index !== state.speechIndex || !isHumanTurn() || !pointEligibility(state, nowTime())[kind]) return;
    generatedPoint = result.text; send('OFFER_POINT', {kind, by});
    if (kind === 'poo') speakAIPoint();
    else notice('The opponent has offered a point. Accept or decline before the offer expires. No substantive interruption until accepted.');
  } catch (error) { notice(`Point generation unavailable: ${error.message}. Your speech continues.`); }
  finally { offerBusy = false; }
}
function speakAIPoint() {
  if (!state.point || !generatedPoint) return;
  restoreMicAfterPoint = microphone && !testingMic; stopMic(); cancelSynthesis(); const epoch = synthesisEpoch, value = generatedPoint;
  appendTranscript(value, state.point.by, 0, nowTime(), `AI ${state.point.kind.toUpperCase()}`);
  try {
    Promise.resolve(voice.speak(value, {onEnd() {
      if (epoch !== synthesisEpoch || !state.point) return;
      if (state.point.kind === 'poo') send('POINT_RESPONSE'); else send('END_POINT');
      notice(microphone ? 'Your floor. Your microphone is restored.' : 'Your floor. Enable the mic or use typed input.');
    }})).catch(error => { if (epoch === synthesisEpoch) notice(`Point is shown in the transcript. Speech playback unavailable: ${error.message}`); });
  } catch (error) { notice(error.message); }
}
function offerHumanPoint(kind) {
  if (pointReplyBusy) { notice('The opponent is answering your last point. Wait for the response before offering another.'); return; }
  send('OFFER_POINT', {kind, by:state.config.side});
  if (!state.point || state.point.by !== state.config.side) return;
  // Recognition is a disclosed practice policy, not an invented model judgment.
  humanOffers++;
  if (state.point.status === 'offered' && !recognizePoint(state.config.difficulty, humanOffers, kind)) { send('DECLINE_POINT'); notice('The opponent declines this point. In Hard and Champion practice, it recognizes alternate legal requests.'); return; }
  if (state.point.status === 'offered') send('ACCEPT_POINT');
  if (!state.point) return;
  cancelSynthesis(); notice(kind === 'poo' ? 'Point of order: explain the alleged new argument in 15 seconds. Main clock paused. Use typed input or enable the mic.' : 'The opponent accepts your point. You have 15 seconds. The speech clock keeps running. Type it or enable the mic.');
}
async function answerHumanPoint() {
  if (pointReplyBusy || !state.point || state.point.by !== state.config.side || isHumanTurn()) return;
  pointReplyBusy = true; stopMic();
  const point = {...state.point}, index = state.speechIndex, token = ++pointReplyEpoch;
  if (point.kind !== 'poo') send('END_POINT');
  try {
    const result = await generate('answer', point);
    if (!result?.text || token !== pointReplyEpoch || index !== state.speechIndex || state.phase !== 'speaking' || (point.kind === 'poo' && !state.point)) return;
    cancelSynthesis(); const epoch = synthesisEpoch;
    appendTranscript(result.text, SPEECHES[index].side, 0, nowTime(), `${speakerName()} · point response`);
    await voice.speak(result.text, {onEnd() {
      if (epoch !== synthesisEpoch || token !== pointReplyEpoch) return;
      pointReplyBusy = false;
      if (state.point) send('END_POINT'); else { playNextChunk(); render(); }
    }});
  } catch (error) { if (token === pointReplyEpoch) { pointReplyBusy = false; notice(`Point response unavailable: ${error.message}. Main speech can continue.`); if (!state.point) playNextChunk(); } }
}
function renderTranscript() {
  if (renderedTranscript === state.transcript.length) return;
  renderedTranscript = state.transcript.length;
  if (!renderedTranscript) return;
  const flow = $('transcript'); const nearBottom = flow.scrollHeight - flow.scrollTop - flow.clientHeight < 100;
  flow.replaceChildren();
  for (const entry of state.transcript) {
    const item = element('article', '');
    item.append(element('div', `${entry.speaker} · ${entry.side === 'gov' ? 'Government' : 'Opposition'} · ${formatTime(Math.max(0, (entry.at - state.createdAt) / 1000))}`, 'entry-meta'), element('p', entry.text)); flow.append(item);
  }
  if (nearBottom) flow.scrollTop = flow.scrollHeight;
}
function renderEditors() {
  $('editable-transcript').replaceChildren();
  if (!state.transcript.length) $('editable-transcript').append(element('p', 'No public transcript was recorded. Coaching cannot invent a round.', 'field-note'));
  state.transcript.forEach((entry, index) => {
    const label = element('label', `${index + 1}. ${entry.speaker} · ${entry.side.toUpperCase()}`);
    const field = document.createElement('textarea'); field.rows = 4; field.value = entry.text; field.maxLength = 20000;
    field.addEventListener('change', () => {
      send('UPDATE_TRANSCRIPT', {index, text:field.value});
      text('review', 'Re-review edited transcript ↗');
      notice('Transcript edited. Existing feedback may be out of date. Re-review to update it.');
    }); label.append(field); $('editable-transcript').append(label);
  });
}
function renderStats(metrics) {
  $('stats').replaceChildren();
  const own = state.transcript.filter(entry => entry.side === state.config.side);
  const words = own.map(entry => entry.text).join(' ').trim().split(/\s+/).filter(Boolean).length;
  const fillerCount = metrics?.fillers ? Object.values(metrics.fillers).reduce((sum,value)=>sum+Number(value),0) : null;
  const values = [[metrics?.words ?? words, 'YOUR TRANSCRIPT WORDS'], [metrics?.wordsPerMinute == null ? '—' : Math.round(metrics.wordsPerMinute), 'WORDS / TIMED MIN'], [metrics?.speakingSeconds == null ? '—' : formatTime(metrics.speakingSeconds), 'TIMED SEGMENTS'], [fillerCount ?? '—', 'LITERAL FILLERS']];
  for (const [value, label] of values) { const stat = element('div','', 'stat'); stat.append(element('strong',value),element('span',label)); $('stats').append(stat); }
  if (metrics?.measurementBasis) $('stats').append(element('p', typeof metrics.measurementBasis === 'string' ? metrics.measurementBasis : JSON.stringify(metrics.measurementBasis), 'field-note'));
}
async function reviewRound() {
  if (reviewing) return;
  reviewing = true; text('coach-output', 'Reviewing the public transcript with your local model. No private prep notes are included.'); render();
  try {
    const result = await generate('coach'); if (!result) return;
    feedback = result; renderStats(result.metrics || result.stats);
    text('coach-output', result.text || result.error || 'Qualitative coaching unavailable. Objective transcript metrics remain available.');
    if (result.error) notice(`Qualitative coaching unavailable: ${result.error}`);
  } catch (error) { feedback = {error:error.message}; renderStats(); text('coach-output', `Qualitative coaching unavailable: ${error.message}\n\nYour transcript is intact. Check the local model, then retry this review.`); }
  finally { reviewing = false; render(); }
}
function finishRound() {
  if (!window.confirm('End this round and open coaching? You can correct the transcript and request a fresh review.')) return;
  stopWork(); aiChunks = []; send('END_ROUND'); showView('report'); renderEditors(); renderStats(); reviewRound();
}
function render(now = nowTime()) {
  const time = clock(state, now), phase = state.phase, speech = SPEECHES[state.speechIndex];
  $('stop').disabled = phase === 'stopped' && !reviewing && !microphone && !busy;
  if (phase === 'setup' && !microphone) $('stop').disabled = true;
  if (phase === 'prep') {
    showView('prep'); text('prep-clock', formatTime(time.remaining)); $('prep-clock').classList.toggle('overtime', time.remaining < 0);
    text('prep-pause', time.running ? 'Pause' : 'Resume');
    document.querySelectorAll('#milestones li').forEach((node,i) => { const m=prepMilestones(state.config.prepSeconds)[i];node.classList.toggle('active', time.elapsed >= m.start && time.elapsed < m.end); });
  }
  if (['ready','roadmap','armed','speaking','between'].includes(phase)) showView('round');
  text('round-title', speech.label); text('speech-kicker', `03 / SPEECH ${state.speechIndex + 1} OF 6 · ${speech.id}`);
  text('speaker-label', `${speakerName()} · ${speech.side === 'gov' ? 'Government' : 'Opposition'} · ${formatTime(state.config.durations[state.speechIndex])} allotted`);
  const custom = state.config.customPOC || state.config.prepSeconds !== DEFAULT_CONFIG.prepSeconds || state.config.durations.some((duration,i)=>duration !== SPEECHES[i].seconds);
  text('speech-guidance', `${custom ? 'Custom practice timing. ' : 'CHSSA preset. '}Roadmaps are off time for at most 15 seconds. Thank-yous are timed.`);
  text('ownership', isHumanTurn() ? 'YOUR FLOOR' : 'AI FLOOR'); text('phase-label', phase === 'speaking' ? time.running ? 'SPEECH IN PROGRESS' : state.point?.kind === 'poo' ? 'POINT OF ORDER · CLOCK PAUSED' : 'PAUSED' : phase.toUpperCase());
  text('speech-clock', formatTime(time.remaining)); $('speech-clock').classList.toggle('overtime', time.remaining < 0);
  const captions = {ready:'Take your place. Choose an off-time roadmap or arm your speech.', roadmap:'Off-time roadmap. Timing starts automatically after 15 seconds.', armed:'Armed. First detected activity starts the timer. Manual start is always available.', speaking:time.remaining < 0 ? 'Overtime. Finish your thought, then explicitly end the speech.' : 'The floor stays yours until you explicitly end this speech.', between:`Between speeches: ${formatTime(Math.max(0,20-(now-(state.betweenAt ?? now))/1000))} of the CHSSA 20-second allowance remains. Advance manually.`, completed:'Round complete. Open your review when ready.', stopped:'Session stopped. Requests, microphone and speech have been cancelled.'};
  text('clock-caption', captions[phase] || '');
  $('roadmap').hidden = phase !== 'ready' || !isHumanTurn(); $('arm').hidden = !['ready','roadmap'].includes(phase); text('arm', isHumanTurn() ? 'Arm speech' : 'Arm timer only');
  $('manual-start').hidden = phase !== 'armed'; $('pause').hidden = !['speaking','roadmap'].includes(phase); text('pause', time.running ? 'Pause' : 'Resume'); $('pause').disabled = state.point?.kind === 'poo';
  $('end-speech').hidden = !['armed','roadmap','speaking'].includes(phase); $('next-speech').hidden = phase !== 'between';
  $('ai-speech').hidden = isHumanTurn() || !['ready','armed','speaking'].includes(phase) || aiGenerationIndex === state.speechIndex;
  $('ai-speech').disabled = busy; text('ai-speech', busy ? 'Thinking locally…' : 'Generate AI speech');
  $('end-round').disabled = false;
  const eligibility = pointEligibility(state, now);
  for (const kind of ['poi','poo','poc']) { $(`offer-${kind}`).disabled = pointReplyBusy || isHumanTurn() || !eligibility[kind]; }
  $('offer-poc').hidden = !state.config.customPOC; text('point-eligibility', pointReplyBusy ? 'The opponent is answering your last point. New points reopen after the response.' : eligibility.reason);
  text('point-rules', state.config.customPOC ? 'CUSTOM CLARIFICATIONS' : 'CHSSA POINTS');
  $('point-box').hidden = !state.point;
  if (state.point) {
    const point = state.point; const offered = point.status === 'offered';
    const remaining = Math.max(0,(offered ? 10 : 15) - (now-point.startedAt)/1000);
    text('point-title', `${point.kind.toUpperCase()} · ${point.by === state.config.side ? 'Your request' : 'Opponent request'} · ${formatTime(remaining)}`);
    text('point-detail', offered ? 'An offer, not an interruption. Recognize the speaker to hear their point.' : `${point.status === 'response' ? 'Response' : 'Explanation'} window. ${point.kind === 'poo' ? 'Speech time is paused. The simulated judge saves assessment for coaching.' : 'The main speech clock keeps running.'}`);
    $('accept-point').hidden = !offered; $('decline-point').hidden = !offered;
    $('point-response').hidden = point.kind !== 'poo' || point.status !== 'explanation'; $('end-point').hidden = offered;
  }
  $('typed-text').disabled = !canHumanSpeak(); $('typed-form').querySelector('button').disabled = !canHumanSpeak();
  $('review').disabled = reviewing; text('review', reviewing ? 'Reviewing locally…' : 'Review this transcript ↗');
  document.querySelectorAll('#speech-track li').forEach((node,index) => { node.classList.toggle('active',index === state.speechIndex);node.classList.toggle('done',index < state.speechIndex); });
  renderTranscript();
}

$('setup-form').addEventListener('submit', event => {
  event.preventDefault(); if (!$('setup-form').reportValidity()) return;
  try {
    stopWork(); state = createRound(configFromForm(), nowTime()); names=[$('speaker-1').value.trim() || 'Speaker one',$('speaker-2').value.trim() || 'Speaker two'];
    aiChunks=[];aiGenerationIndex=-1;humanOffers=0;lastOfferAt=-Infinity;renderedTranscript=-1;feedback=null;
    text('prep-motion',state.config.resolution); $('milestones').replaceChildren();
    for (const m of prepMilestones(state.config.prepSeconds)) { const li=element('li','');li.append(element('span',`${formatTime(m.start)}–${formatTime(m.end)}`),element('strong',m.label));$('milestones').append(li); }
    $('speech-track').replaceChildren();
    SPEECHES.forEach((s,i)=> {const li=element('li','');li.append(element('strong',s.id),element('small',`${s.side.toUpperCase()} · ${formatTime(state.config.durations[i])}`));$('speech-track').append(li);});
    $('transcript').replaceChildren(element('p','Your public arguments will appear here.','empty-state'));
    notice(state.config.model ? '' : 'No model selected. Timers and typed practice work, but AI generation and qualitative coaching require a local model.');send('START_PREP');
  } catch(error) { notice(error.message); }
});
$('setup-form').addEventListener('input', updateFormat);
$('refresh-models').addEventListener('click',refreshModels);
$('skip-prep').addEventListener('click',()=>{stopMic();send('SKIP_PREP');});
$('roadmap').addEventListener('click',()=>send('BEGIN_ROADMAP'));
$('arm').addEventListener('click',()=>{
  const restart = microphone && state.phase === 'roadmap';
  if (restart) stopMic();
  send('ARM_SPEECH');
  // Fresh capture discards pending roadmap words and rearms the adapter's first-activity signal.
  if (restart) startMic(false);
});
$('manual-start').addEventListener('click',()=>send('VOICE_START'));
for (const id of ['pause','prep-pause']) $(id).addEventListener('click',()=>{
  const running=clock(state,nowTime()).running;send(running?'PAUSE':'RESUME');
  if (running) voice.pauseSpeech();else { voice.resumeSpeech(); playNextChunk(); }
});
$('end-speech').addEventListener('click',()=>{
  stopWork();aiChunks=[];send('END_SPEECH');
  if(state.phase==='completed'){send('END_ROUND');showView('report');renderEditors();renderStats();reviewRound();}
});
$('next-speech').addEventListener('click',()=>{stopWork();aiChunks=[];aiGenerationIndex=-1;lastSegmentAt=0;send('NEXT_SPEECH');notice('');});
$('end-round').addEventListener('click',finishRound);
$('stop').addEventListener('click',()=>{stopWork();aiChunks=[];send('STOP');if(view==='prep')showView('round');if(view==='report')text('coach-output','Review stopped. Your transcript is retained. Choose Review this transcript to try again.');notice('Session stopped. Microphone, speech and pending requests are off. Your public transcript is retained. End round & review to save it.');});
$('ai-speech').addEventListener('click',generateSpeech);
$('typed-form').addEventListener('submit',event=>{event.preventDefault();const value=$('typed-text').value.trim();if(!value)return;addHumanTranscript(value);$('typed-text').value='';});
for(const kind of ['poi','poo','poc']) $(`offer-${kind}`).addEventListener('click',()=>offerHumanPoint(kind));
$('accept-point').addEventListener('click',()=>{send('ACCEPT_POINT');if(state.point?.status==='explanation')speakAIPoint();});
$('decline-point').addEventListener('click',()=>send('DECLINE_POINT'));
$('point-response').addEventListener('click',()=>send('POINT_RESPONSE'));
$('end-point').addEventListener('click',()=>send('END_POINT'));
$('mic-test').addEventListener('click',()=>startMic(true));$('mic-start').addEventListener('click',()=>startMic(false));$('mic-stop').addEventListener('click',stopMic);
$('voice-mode').addEventListener('change',stopMic);$('browser-consent').addEventListener('change',()=>{if(!$('browser-consent').checked&&$('voice-mode').value==='browser')stopMic();});
$('private-notes').addEventListener('input',()=>text('notes-count',`${$('private-notes').value.trim().split(/\s+/).filter(Boolean).length} words · aim for 250–350 per speaker's paper notes`));
$('review').addEventListener('click',reviewRound);
$('export').addEventListener('click',()=>{
  const url=URL.createObjectURL(new Blob([sessionExport(state,feedback)],{type:'application/json'}));
  const link=document.createElement('a');link.href=url;link.download=`parlibot-round-${new Date().toISOString().slice(0,10)}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);notice('Session exported. It includes public transcript, timer events and feedback, never private prep notes.');
});
$('new-round').addEventListener('click',()=>{stopWork();state=createRound(DEFAULT_CONFIG,nowTime());showView('setup');notice('Your previous notes remain in this tab until you replace them. Export before starting another round if you want the public record.');render();});
window.addEventListener('pagehide',stopWork);
setInterval(()=>{if(!['setup','completed','stopped'].includes(state.phase))send('TICK');else render();},200);
refreshModels();render();

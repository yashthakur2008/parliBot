// Small view helpers deliberately keep untrusted model/transcript content as text.
export function setText(node, value) { node.textContent = String(value ?? ''); }
export function publicTranscript(entries = []) {
  return entries.map(({text, speaker, side, at, duration}) => ({text, speaker, side, at, duration}));
}
export function modelRequest(state, mode, point) {
  const {resolution, side, difficulty, judge, prepSeconds, durations, customPOC, model} = state.config;
  return {model, mode, config: {resolution, side, difficulty, judge, prepSeconds, durations, customPOC, model},
    speechIndex: state.speechIndex, transcript: publicTranscript(state.transcript), ...(point ? {point} : {})};
}
export function sessionExport(state, feedback) {
  return JSON.stringify({version: 1, exportedAt: new Date().toISOString(), config: modelRequest(state, 'coach').config,
    transcript: publicTranscript(state.transcript), events: state.events, feedback}, null, 2);
}
export function prepMilestones(total) {
  const labels = ['Interpret the motion', 'Choose your advocacy', 'Research & verify', 'Construct the case', 'Attack & repair', 'Build paper notes', 'Handoff & rehearse'];
  const bounds = [0, 2, 4, 9, 12, 15, 18, 20];
  return labels.map((label, i) => ({label, start: total * bounds[i] / 20, end: total * bounds[i + 1] / 20}));
}
export function createRequestGate() {
  const active = new Map();
  return {
    begin(key) {
      active.get(key)?.abort();
      const controller = new AbortController(); active.set(key, controller);
      return {signal: controller.signal, current: () => active.get(key) === controller && !controller.signal.aborted,
        finish: () => { if (active.get(key) === controller) active.delete(key); }};
    },
    abort() { for (const controller of active.values()) controller.abort(); active.clear(); }
  };
}
export function textElement(document, tag, text, className) {
  const node = document.createElement(tag); setText(node, text);
  if (className) node.className = className;
  return node;
}
export function extractSentences(buffer, final = false) {
  const sentences = []; let rest = buffer;
  const pattern = /^([\s\S]*?[.!?](?:["')\]]*)(?=\s|$))/;
  while (rest) { const match = rest.match(pattern); if (!match) break; if (match[1].trim()) sentences.push(match[1].trim()); rest = rest.slice(match[1].length); }
  if (final && rest.trim()) sentences.push(rest.trim());
  return {sentences, rest: final ? '' : rest};
}
export async function readModelStream(response, onDelta) {
  if (!response.body) throw new Error('Streaming is unavailable in this browser.');
  const reader = response.body.getReader(), decoder = new TextDecoder(); let buffer = '', terminal = null;
  function parse(line) {
    if (!line.trim()) return;
    const message = JSON.parse(line);
    if (message.error) throw new Error(message.error);
    if (typeof message.delta === 'string') onDelta(message.delta);
    if (message.done) terminal = message;
  }
  try {
    while (true) {
      const {value, done} = await reader.read();
      buffer += decoder.decode(value, {stream: !done});
      let end;
      while ((end = buffer.indexOf('\n')) !== -1) { parse(buffer.slice(0,end)); buffer = buffer.slice(end + 1); }
      if (done) break;
    }
    if (buffer.trim()) parse(buffer);
    if (!terminal) throw new Error('The model stream ended early. Your completed transcript is retained.');
    return terminal;
  } finally { reader.releaseLock(); }
}
export function recognizePoint(difficulty, offerNumber, kind) {
  return kind === 'poo' || !['hard','champion'].includes(difficulty) || offerNumber % 2 === 1;
}
export function renderSpeechPreview(node, {text = '', final = false} = {}) {
  const partial = !final && text.trim();
  setText(node, partial ? `Listening · ${partial}` : '');
  node.hidden = !partial;
}

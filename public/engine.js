// Pure round rules. Millisecond timestamps in, second-based displays out.
export const SPEECHES = Object.freeze([
  { id: 'PMC', label: 'Prime Minister Constructive', side: 'gov', speaker: 1, seconds: 420 },
  { id: 'LOC', label: 'Leader of Opposition Constructive', side: 'opp', speaker: 1, seconds: 480 },
  { id: 'MGC', label: 'Member of Government Constructive', side: 'gov', speaker: 2, seconds: 480 },
  { id: 'MOC', label: 'Member of Opposition Constructive', side: 'opp', speaker: 2, seconds: 480 },
  { id: 'LOR', label: 'Leader of Opposition Rebuttal', side: 'opp', speaker: 1, seconds: 240 },
  { id: 'PMR', label: 'Prime Minister Rebuttal', side: 'gov', speaker: 1, seconds: 300 },
].map(Object.freeze));
export const DEFAULT_CONFIG = Object.freeze({
  resolution: '', side: 'gov', difficulty: 'medium', judge: 'Clear reasoning and comparative weighing for a lay judge.',
  prepSeconds: 1200, durations: Object.freeze(SPEECHES.map(s => s.seconds)), customPOC: false, model: '',
});
const freshClock = (duration, startedAt = null) => ({ duration, elapsed: 0, startedAt });
const seconds = (value, label, zero = false) => {
  if (!Number.isFinite(value) || value < (zero ? 0 : 1) || value > 7200) throw new Error(`Invalid ${label}: use ${zero ? '0' : '1'}–7200 seconds.`);
  return value;
};
export function createRound(config = {}, now = 0) {
  const c = { ...DEFAULT_CONFIG, ...config };
  c.prepSeconds = seconds(c.prepSeconds, 'prep time', true);
  if (!Array.isArray(c.durations) || c.durations.length !== 6) throw new Error('Six speech durations are required.');
  c.durations = Array.from(c.durations, d => seconds(d, 'duration'));
  if (!['gov', 'opp'].includes(c.side)) throw new Error('Choose Government or Opposition.');
  if (!['easy', 'medium', 'hard', 'champion'].includes(c.difficulty)) throw new Error('Unknown difficulty.');
  return { config: c, phase: 'setup', speechIndex: 0, clock: freshClock(c.prepSeconds), point: null,
    transcript: [], events: [], speechTimings: [], createdAt: now, betweenAt: null };
}
export function clock(state, now) {
  const c = state.clock;
  const elapsed = c.elapsed + (c.startedAt === null ? 0 : Math.max(0, now - c.startedAt) / 1000);
  return { elapsed, remaining: c.duration - elapsed, overtime: Math.max(0, elapsed - c.duration), running: c.startedAt !== null };
}
function pause(state, now) {
  state.clock = { ...state.clock, elapsed: clock(state, now).elapsed, startedAt: null };
}
function resume(state, now) {
  if (state.clock.startedAt === null) state.clock = { ...state.clock, startedAt: now };
}
function resetSpeech(state) {
  state.phase = 'ready'; state.point = null;
  state.clock = freshClock(state.config.durations[state.speechIndex]);
}
export function pointEligibility(state, now) {
  const denied = { poi: false, poo: false, poc: false };
  if (state.phase !== 'speaking') return { ...denied, reason: 'Points are available during a speech.' };
  if (state.point) return { ...denied, reason: 'Resolve the current point first.' };
  if (!clock(state, now).running) return { ...denied, reason: 'The speech is paused.' };
  const { elapsed, remaining } = clock(state, now);
  const constructive = state.speechIndex < 4;
  const poi = constructive && elapsed >= 60 && remaining > 60;
  return { poi, poo: !constructive, poc: Boolean(state.config.customPOC),
    reason: poi ? 'POIs open · maximum 15 seconds · clock keeps running.' : constructive
      ? 'Protected time: first and last minute.' : 'Rebuttal: POOs for new arguments only.' };
}
function record(state, type, now, extra = {}) {
  state.events.push({ type, at: now, speechIndex: state.speechIndex, ...extra });
}
function finishPoint(state, now) {
  if (!state.point) return;
  const kind = state.point.kind;
  if (kind === 'poo') resume(state, now);
  record(state, 'POINT_ENDED', now, { kind });
  state.point = null;
}
function tick(state, now) {
  if (state.phase === 'roadmap' && clock(state, now).elapsed >= 15) {
    const overtime = clock(state, now).elapsed - 15;
    state.clock = freshClock(state.config.durations[state.speechIndex], now - overtime * 1000);
    state.phase = 'speaking'; record(state, 'ROADMAP_OVERTIME', now);
  }
  const p = state.point;
  if (!p) return;
  if (p.status === 'offered') {
    if (now - p.startedAt >= 10000) { state.point = null; record(state, 'POINT_EXPIRED', now); }
  } else if (p.kind === 'poo') {
    if (p.status === 'explanation' && now - p.startedAt >= 15000) {
      state.point = { ...p, status: 'response', startedAt: p.startedAt + 15000 };
    }
    if (state.point?.status === 'response' && now - state.point.startedAt >= 15000) {
      finishPoint(state, state.point.startedAt + 15000);
    }
  } else if (now - p.startedAt >= 15000) finishPoint(state, p.startedAt + 15000);
}
export function dispatch(previous, event, now = 0) {
  if (!Number.isFinite(now)) throw new Error('Invalid clock timestamp.');
  const state = { ...previous, clock: { ...previous.clock }, events: [...previous.events],
    transcript: [...previous.transcript], speechTimings: [...previous.speechTimings], point: previous.point ? { ...previous.point } : null };
  tick(state, now);
  const phase = state.phase;
  const type = event.type;
  switch (type) {
    case 'TICK': return state;
    case 'START_PREP':
      if (phase !== 'setup') return state;
      state.phase = 'prep'; state.clock = freshClock(state.config.prepSeconds, now); break;
    case 'SKIP_PREP':
      if (!['setup', 'prep'].includes(phase)) return state;
      resetSpeech(state); break;
    case 'BEGIN_ROADMAP':
      if (phase !== 'ready') return state;
      state.phase = 'roadmap'; state.clock = freshClock(15, now); break;
    case 'ARM_SPEECH':
      if (!['ready', 'roadmap'].includes(phase)) return state;
      state.phase = 'armed'; state.clock = freshClock(state.config.durations[state.speechIndex]); break;
    case 'VOICE_START':
      if (phase !== 'armed') return state;
      state.phase = 'speaking'; resume(state, now); break;
    case 'PAUSE':
      if (!['prep', 'speaking', 'roadmap'].includes(phase) || state.point?.kind === 'poo') return state;
      pause(state, now); break;
    case 'RESUME':
      if (!['prep', 'speaking', 'roadmap'].includes(phase) || state.point?.kind === 'poo') return state;
      resume(state, now); break;
    case 'END_SPEECH':
      if (!['armed', 'roadmap', 'speaking'].includes(phase)) return state;
      if (phase === 'roadmap') state.clock = freshClock(state.config.durations[state.speechIndex]);
      pause(state, now); state.speechTimings[state.speechIndex] = clock(state, now).elapsed;
      state.phase = state.speechIndex === 5 ? 'completed' : 'between'; state.betweenAt = now; state.point = null; break;
    case 'NEXT_SPEECH':
      if (phase !== 'between') return state;
      state.speechIndex += 1; resetSpeech(state); break;
    case 'END_ROUND':
    case 'STOP':
      pause(state, now); state.point = null; state.phase = type === 'STOP' ? 'stopped' : 'completed'; break;
    case 'OFFER_POINT': {
      const kind = event.kind;
      if (!['poi', 'poo', 'poc'].includes(kind) || !['gov', 'opp'].includes(event.by)) return state;
      if (event.by === SPEECHES[state.speechIndex].side || !pointEligibility(state, now)[kind]) return state;
      state.point = { kind, by: event.by, status: kind === 'poo' ? 'explanation' : 'offered', startedAt: now };
      if (kind === 'poo') pause(state, now);
      break;
    }
    case 'ACCEPT_POINT': {
      if (state.point?.status !== 'offered') return state;
      const p = state.point;
      if (!pointEligibility({ ...state, point: null }, now)[p.kind]) { state.point = null; return state; }
      state.point = { ...p, status: 'explanation', startedAt: now }; break;
    }
    case 'DECLINE_POINT':
      if (state.point?.status !== 'offered') return state;
      state.point = null; break;
    case 'POINT_RESPONSE':
      if (state.point?.kind !== 'poo' || state.point.status !== 'explanation') return state;
      state.point = { ...state.point, status: 'response', startedAt: now }; break;
    case 'END_POINT': finishPoint(state, now); break;
    case 'ADD_TRANSCRIPT': {
      const text = typeof event.text === 'string' ? event.text.trim().slice(0, 20000) : '';
      if (!text || !['gov', 'opp'].includes(event.side)) return state;
      state.transcript.push({ text, speaker: String(event.speaker || SPEECHES[state.speechIndex].id).slice(0, 100),
        side: event.side, at: Number.isFinite(event.at) ? event.at : now, duration: Number.isFinite(event.duration) && event.duration > 0 ? event.duration : 0,
        speechIndex: state.speechIndex }); break;
    }
    case 'UPDATE_TRANSCRIPT':
      if (!Number.isInteger(event.index) || !state.transcript[event.index] || typeof event.text !== 'string') return state;
      state.transcript[event.index] = { ...state.transcript[event.index], text: event.text.trim().slice(0, 20000), corrected: true }; break;
    default: return state;
  }
  record(state, type, now);
  return state;
}
export function formatTime(seconds) {
  if (!Number.isFinite(seconds)) return '00:00';
  const value = Math.ceil(Math.abs(seconds));
  return `${seconds < 0 ? '+' : ''}${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
}

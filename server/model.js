import { COACH_FORMAT } from './coach-contract.js';
import { buildMessages } from './prompts.js';
const OLLAMA = 'http://127.0.0.1:11434';
const MAX_OUTPUT = 1024 * 1024;
// A loopback daemon can proxy cloud inference. Fail closed unless local weights
// are explicitly described by both the model catalog and /api/show.
function remoteMetadata(value) {
 if (!value || typeof value !== 'object') return false;
 return Object.entries(value).some(([key, item]) =>
  (/remote|cloud/i.test(key) && Boolean(item)) ||
  (typeof item === 'object' && remoteMetadata(item)));
}
function localCatalogEntry(item) {
 return typeof item?.name === 'string' && !/cloud/i.test(item.name) &&
  !remoteMetadata(item) && item.details?.format === 'gguf' &&
  Number.isFinite(item.size) && item.size > 0 && /^[a-f0-9]{64}$/i.test(item.digest ?? '');
}
function localWeights(info) {
 return !remoteMetadata(info) && info.details?.format === 'gguf' &&
  typeof info.model_info?.['general.architecture'] === 'string' &&
  Number.isFinite(info.model_info?.['general.parameter_count']) &&
  info.model_info['general.parameter_count'] > 0 &&
  Array.isArray(info.tensors) && info.tensors.length > 0;
}

export function createModel({ fetchImpl = globalThis.fetch } = {}) {
 const contextLimits = new Map();
 async function request(path, options = {}, signal, timeout = 5000) {
  const combined = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(timeout)]);
  const response = await fetchImpl(`${OLLAMA}${path}`, { ...options, signal: combined, redirect: 'error' });
  if (!response.ok) throw new Error('Local Ollama request failed');
  return response;
 }
 async function status({ signal } = {}) {
  const data = await (await request('/api/tags', {}, signal)).json();
  if (!Array.isArray(data.models)) throw new Error('Invalid Ollama model list');
  const verified = await Promise.all(data.models.filter(localCatalogEntry).slice(0, 64).map(async item => {
   try {
    const info = await (await request('/api/show', {
     method: 'POST', headers: {'content-type':'application/json'},
     body: JSON.stringify({model:item.name})
    }, signal)).json();
    if (!localWeights(info)) return null;
    const architecture = info.model_info['general.architecture'];
    const supported = info.model_info[`${architecture}.context_length`];
    contextLimits.set(item.name, Number.isInteger(supported) && supported > 0 ? Math.min(32768, supported) : 4096);
    return {name:item.name};
   } catch (error) {
    if (signal?.aborted) throw error;
    return null;
   }
  }));
  return verified.filter(Boolean);
 }
 async function chat(input, stream, signal) {
  const models = await status({ signal });
  if (!input.model || !models.some(item => item.name === input.model)) {
   throw new Error('Selected model is not installed in local Ollama');
  }
  const messages = buildMessages(input);
  const numCtx = contextLimits.get(input.model) ?? 4096;
  const seconds = input.config?.durations?.[input.speechIndex] ?? 420;
  const numPredict = input.mode === 'speech' ? Math.min(4096, Math.max(64, Math.ceil(seconds * 3.5))) : input.mode === 'coach' ? 4096 : 128;
  // UTF-8 bytes are a conservative bound for byte-fallback tokenizers. Reserve
  // template overhead and the entire output budget; never silently drop entries.
  const inputBound = messages.reduce((sum, message) => sum + Buffer.byteLength(message.content, 'utf8'), 1024);
  if (inputBound + numPredict > numCtx) {
   throw Object.assign(new Error(`Transcript exceeds the safe context budget for this model (${numCtx} tokens). Shorten or split the public transcript before retrying; no entries were omitted.`), {statusCode:400});
  }
  return request('/api/chat', {
   method: 'POST',
   headers: { 'content-type': 'application/json' },
   body: JSON.stringify({
    model: input.model,
    messages,
    stream,
    ...(input.mode === 'coach' ? {format:COACH_FORMAT} : {}),
    options: { num_ctx: numCtx, num_predict: numPredict, temperature: 0.6 }
   })
  }, signal, stream ? 600000 : 180000);
 }
 async function generate(input, { signal } = {}) {
  const data = await (await chat(input, false, signal)).json();
  const text = data.message?.content;
  if (typeof text !== 'string' || !text.trim() || text.length > MAX_OUTPUT) {
   throw new Error('Local model returned invalid text');
  }
  return text;
 }
 async function* stream(input, { signal } = {}) {
  const response = await chat(input, true, signal);
  if (!response.body) throw new Error('Local model returned no stream');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let total = 0;
  let completed = false;
  try {
   while (!completed) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    if (buffer.length > MAX_OUTPUT) throw new Error('Local stream frame too large');
    const lines = buffer.split('\n');
    buffer = lines.pop();
    if (done && buffer.trim()) { lines.push(buffer); buffer = ''; }
    for (const line of lines) {
     if (!line.trim()) continue;
     const frame = JSON.parse(line);
     if (frame.error) throw new Error('Local model stream failed');
     const delta = frame.message?.content;
     if (delta !== undefined && typeof delta !== 'string') throw new Error('Invalid stream content');
     if (delta) {
      total += delta.length;
      if (total > MAX_OUTPUT) throw new Error('Local stream output too large');
      yield delta;
     }
     if (frame.done === true) { completed = true; break; }
    }
    if (done) break;
   }
   if (!completed || !total) throw new Error('Local stream ended without a complete response');
  } finally {
   await reader.cancel().catch(() => {});
   reader.releaseLock();
  }
 }
 return { status, generate, stream };
}

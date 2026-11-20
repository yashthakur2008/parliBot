// No microphone access occurs until start() is called by a UI user action.
export class VoiceController {
  constructor({onTranscript=()=>{},onActivity=()=>{},onLevel=()=>{},onStatus=()=>{}}={}) {
    Object.assign(this,{onTranscript,onActivity,onLevel,onStatus});
    this.captureEpoch=0; this.speechEpoch=0; this.seen=new Set();
    // Enumeration can initialize Chrome's native voice bridge slowly on cold load.
    // This does not play audio, request permissions, or touch the microphone.
    globalThis.speechSynthesis?.getVoices?.();
  }
  async start({mode='local'}={}) {
    this.stopCapture();
    if(this.speaking) throw new Error('Pause or cancel AI speech before enabling the microphone.');
    const epoch=++this.captureEpoch;
    this.active=true; this.activity=false; this.seen.clear(); this.mode=mode;
    try {
      if(mode==='browser') {
        const Recognition=globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition;
        if(!Recognition) throw new Error('Browser speech recognition is unavailable. Use local voice or typed input.');
        this.onStatus({state:'warning',message:'Opt-in browser recognition may send audio to the browser vendor. It is not guaranteed offline.'});
        const recognition=this.recognition=new Recognition();
        recognition.continuous=true;recognition.interimResults=true;recognition.lang='en-US';
        recognition.onresult=event=>{
          for(let i=event.resultIndex;i<event.results.length;i++) {
            this.receive({type:'activity'},epoch);
            this.receive({type:'transcript',id:`browser-${i}`,text:event.results[i][0].transcript,final:event.results[i].isFinal},epoch);
          }
        };
        recognition.onerror=event=>{if(epoch===this.captureEpoch){this.stopCapture();this.onStatus({state:'error',message:`Browser recognition: ${event.error}`});}};
        recognition.onend=()=>{if(epoch===this.captureEpoch){this.stopCapture();this.onStatus({state:'stopped',message:'Recognition ended. Start the microphone again to continue.'});}};
        recognition.start();
      } else if(mode==='local') {
        await this.captureStop;
        if(epoch!==this.captureEpoch)return;
        const stream=this.stream=new EventSource('/api/speech/events');
        stream.onmessage=event=>{try {this.receive(JSON.parse(event.data),epoch);} catch { /* Ignore invalid transport events. */ }};
        await new Promise((resolve,reject)=>{
          const timer=setTimeout(()=>reject(new Error('Local speech connection timed out.')),5000);
          stream.onopen=()=>{clearTimeout(timer);resolve();};
          stream.onerror=()=>{clearTimeout(timer);reject(new Error('Local speech connection failed.'));};
        });
        if(epoch!==this.captureEpoch)return;
        stream.onerror=()=>{if(epoch===this.captureEpoch){this.stopCapture();this.onStatus({state:'error',message:'Local speech disconnected. Start microphone again.'});}};
        const response=await fetch('/api/speech/start',{method:'POST'});
        const data=await response.json();
        if(!response.ok)throw new Error(data.error || 'Local voice unavailable. Run npm run setup:voice.');
        if(epoch!==this.captureEpoch)return;
      } else throw new Error('Unknown voice mode.');
      this.onStatus({state:mode==='local'?'starting':'listening',message:mode==='local'?'Waiting for local microphone permissions and recognition.':'Browser/vendor microphone enabled.'});
    } catch(error) {
      if(epoch===this.captureEpoch){this.stopCapture();this.onStatus({state:'error',message:error.message});}
      throw error;
    }
  }
  receive(event,epoch) {
    if(epoch!==this.captureEpoch || !this.active || this.speaking)return;
    if(event.type==='activity' && !this.activity){this.activity=true;this.onActivity();}
    if(event.type==='level')this.onLevel(Math.max(0,Math.min(1,Number(event.level)||0)));
    if(event.type==='status'){
      this.onStatus({state:event.state,message:event.message});
      if(event.state==='error'||event.state==='stopped')this.stopCapture();
    }
    if(event.type==='transcript' && event.final===false && event.text?.trim()) {
      if(!event.id || !this.seen.has(event.id))this.onTranscript({text:event.text.trim(),final:false});
    }
    if(event.type==='transcript' && event.final===true && event.text?.trim()) {
      const id=event.id;
      if(id && this.seen.has(id))return;
      if(id)this.seen.add(id);
      this.onTranscript({text:event.text.trim(),final:true});
    }
  }
  stopCapture() {
    ++this.captureEpoch;this.active=false;
    this.recognition?.abort();this.recognition=null;
    if(this.stream){
      this.stream.close();this.stream=null;
      const stopping=fetch('/api/speech/stop',{method:'POST',keepalive:true}).catch(()=>{});
      this.captureStop=Promise.all([this.captureStop,stopping]).then(()=>{});
    }
    this.onLevel(0);
  }
  stop(){this.stopCapture();this.cancelSpeech();this.onStatus({state:'stopped',message:'Microphone and speech stopped.'});}
  speak(text,{onStart=()=>{},onEnd=()=>{}}={}) {
    this.cancelSpeech();this.stopCapture();
    const epoch=++this.speechEpoch;
    this.speaking=true;
    return new Promise((resolve,reject)=>{
      const synth=globalThis.speechSynthesis;
      let timer=null, poll=null, started=false, voiceReady=false;
      const clean=()=>{clearTimeout(timer);clearInterval(poll);synth?.removeEventListener?.('voiceschanged',voicesChanged);};
      const fail=message=>{
        if(epoch!==this.speechEpoch)return;
        clean();this.settleSpeech=null;this.speaking=false;this.queue=[];++this.speechEpoch;
        synth?.cancel();
        this.onStatus({state:'error',message});
        reject(new Error(message));
      };
      this.settleSpeech=()=>{clean();resolve();};
      const segments=String(text).match(/[^.!?]+[.!?]+|[^.!?]+$/g)||[];
      this.queue=segments.flatMap(s=>s.trim().match(/.{1,220}(?:\s|$)|.{1,220}/g)||[]).filter(Boolean);
      const next=voice=>{
        if(epoch!==this.speechEpoch)return;
        const segment=this.queue.shift();
        if(!segment){clean();this.settleSpeech=null;this.speaking=false;resolve();onEnd();return;}
        try {
          const utterance=new SpeechSynthesisUtterance(segment);
          utterance.voice=voice;
          utterance.onstart=()=>{if(epoch===this.speechEpoch&&!started){started=true;onStart();}};
          utterance.onend=()=>next(voice);
          utterance.onerror=()=>fail('Speech synthesis playback failed. Text remains available.');
          this.utterance=utterance;synth.speak(utterance);
        }catch{fail('Speech synthesis playback failed. Text remains available.');}
      };
      const localVoice=()=>synth.getVoices?.().find(v=>v.localService===true && /^en(?:-|$)/i.test(v.lang));
      const voicesChanged=()=>{
        if(epoch!==this.speechEpoch || voiceReady)return;
        const voice=localVoice();
        if(voice){voiceReady=true;clean();next(voice);}
      };
      if(!synth || !globalThis.SpeechSynthesisUtterance){fail('Speech synthesis unavailable. Read the displayed speech.');return;}
      const voice=localVoice();
      if(voice){next(voice);return;}
      this.onStatus({state:'loading',message:'Loading installed local speech voices…'});
      synth.addEventListener?.('voiceschanged',voicesChanged);
      // Some Chromium builds populate getVoices without a timely voiceschanged event.
      poll=setInterval(voicesChanged,100);
      timer=setTimeout(()=>{
        const voice=localVoice();
        if(voice){voiceReady=true;clean();next(voice);}
        else fail('No installed local English synthesis voice is available. Install a system voice or read the displayed text.');
      },8000);
    });
  }
  cancelSpeech(){
    ++this.speechEpoch;this.queue=[];this.speaking=false;
    const settle=this.settleSpeech;this.settleSpeech=null;settle?.();
    globalThis.speechSynthesis?.cancel();
  }
  pauseSpeech(){globalThis.speechSynthesis?.pause();}
  resumeSpeech(){globalThis.speechSynthesis?.resume();}
}

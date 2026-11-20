import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
const exec=promisify(execFile);
const defaultHelper=fileURLToPath(new URL('../native/build/ParliBotVoice.app/Contents/MacOS/ParliBotVoice',import.meta.url));

// Caller must apply its localhost Host/Origin checks before routing here.
export function createSpeechAdapter({helperPath=defaultHelper}={}) {
  const clients=new Set();let child=null, pending=null, generation=0;
  const send=event=>{for(const res of clients){if(!res.write(`data: ${JSON.stringify(event)}\n\n`)){res.end();clients.delete(res);}}};
  const stop=()=>{++generation;const old=child;child=null;if(old){old.kill('SIGTERM');const timer=setTimeout(()=>old.kill('SIGKILL'),1500);timer.unref();old.once('exit',()=>clearTimeout(timer));}};
  async function status(){
    try{
      const {stdout}=await exec(helperPath,['--probe'],{timeout:8000,maxBuffer:16384});
      const result=JSON.parse(stdout.trim());
      return {available:result.supportsOnDeviceRecognition===true,mode:'local',...(!result.supportsOnDeviceRecognition?{error:'On-device English speech unavailable on this Mac. Use typed input. No cloud fallback is enabled.'}:{}),authorization:result.authorization};
    }catch{return {available:false,mode:'local',error:'Local speech helper unavailable. Run npm run setup:voice.'};}
  }
  async function start(){
    if(child)return;
    if(pending)return pending;
    const epoch=generation;
    pending=(async()=>{
      const capability=await status();
      if(!capability.available)throw new Error(capability.error);
      if(epoch!==generation||!clients.size)throw new Error('Microphone start cancelled or no event listener connected.');
      const process=child=spawn(helperPath,['--listen'],{stdio:['ignore','pipe','pipe']});
      let buffer='';
      process.stdout.setEncoding('utf8');
      process.stdout.on('data',chunk=>{
        if(child!==process)return;
        buffer+=chunk;
        if(buffer.length>262144){stop();send({type:'status',state:'error',message:'Invalid speech helper output.'});return;}
        let index;
        while((index=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,index);buffer=buffer.slice(index+1);try{send(JSON.parse(line));}catch{}}
      });
      process.stderr.resume(); // Do not retain or log speech/transcripts.
      process.on('error',()=>{if(child===process){child=null;send({type:'status',state:'error',message:'Could not start local speech helper.'});}});
      process.on('exit',code=>{if(child===process){child=null;send({type:'status',state:code===0?'stopped':'error',message:code===0?'Local microphone stopped.':'Local recognition ended. Check macOS microphone and speech permissions, then retry.'});}});
    })();
    try{await pending;}finally{pending=null;}
  }
  async function handle(req,res){
    const path=new URL(req.url,'http://127.0.0.1').pathname;
    if(!['/api/speech/events','/api/speech/start','/api/speech/stop'].includes(path))return false;
    const json=(code,data)=>{res.writeHead(code,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
    if(path==='/api/speech/events'&&req.method==='GET'){
      // A single active voice client avoids cross-tab transcript disclosure.
      if(clients.size){json(409,{error:'Voice is already open in another tab.'});return true;}
      res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-store','Connection':'keep-alive'});
      res.write(': connected\n\n');clients.add(res);
      const heartbeat=setInterval(()=>res.write(': heartbeat\n\n'),15000);heartbeat.unref();
      res.on('close',()=>{clearInterval(heartbeat);clients.delete(res);if(!clients.size)stop();});
    }else if(req.method==='POST'&&path==='/api/speech/start'){
      try{await start();json(200,{ok:true});}catch(error){json(503,{error:error.message});}
    }else if(req.method==='POST'&&path==='/api/speech/stop'){stop();json(200,{ok:true});}
    else json(405,{error:'Method not allowed'});
    return true;
  }
  return {status,handle,close(){stop();for(const res of clients)res.end();clients.clear();}};
}

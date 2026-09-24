<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <style>
    :root{font-family:Arial,sans-serif;color:#172434;background:#eef3f5}*{box-sizing:border-box}body{margin:0;padding:16px}.shell{min-height:410px;display:flex;flex-direction:column;gap:14px}.options{display:grid;grid-template-columns:1fr 1fr auto;gap:14px;align-items:end;padding:14px;border:1px solid #d7e2e8;border-radius:10px;background:#fff}.field{display:flex;flex-direction:column;gap:6px;font-size:12px;font-weight:700;color:#34495a}.field select{height:38px;padding:0 10px;border:1px solid #9aabba;border-radius:7px;background:#fff;color:#172434}.mic{height:38px;display:flex;align-items:center;gap:8px;font-size:12px;font-weight:700;color:#34495a}.mic input{width:16px;height:16px;accent-color:#07899a}.stage{position:relative;min-height:270px;display:grid;place-items:center;overflow:hidden;border-radius:10px;background:#0b2634;color:#fff}.stage video{width:100%;height:100%;max-height:360px;object-fit:contain;background:#071b27}.empty{text-align:center;padding:28px}.empty strong{display:block;margin-bottom:7px;font-size:16px}.empty p{margin:0;color:#b8ccd7;font-size:12px;line-height:1.5}.countdown{position:absolute;inset:0;display:none;place-items:center;background:rgba(5,23,33,.68);font-size:74px;font-weight:800}.countdown.show{display:grid}.status{position:absolute;left:12px;bottom:12px;display:none;align-items:center;gap:8px;padding:7px 10px;border-radius:999px;background:rgba(3,18,27,.82);font-size:12px}.status.show{display:flex}.dot{width:9px;height:9px;border-radius:50%;background:#ef4438;animation:pulse 1s infinite}.time{font-variant-numeric:tabular-nums}.actions{display:flex;justify-content:flex-end;gap:9px}.btn{min-height:38px;padding:0 16px;border:1px solid #8da1af;border-radius:999px;background:#fff;color:#17354b;font-weight:700;cursor:pointer}.btn.primary{border-color:#07899a;background:#07899a;color:#fff}.btn.danger{border-color:#d0a3a0;color:#a52a20}.btn:disabled{opacity:.5;cursor:default}.error{display:none;padding:9px 12px;border-radius:7px;background:#fde8ec;color:#b3133b;font-size:12px}.error.show{display:block}@keyframes pulse{50%{opacity:.35;transform:scale(.82)}}@media(max-width:620px){.options{grid-template-columns:1fr}.shell{min-height:480px}}
  </style>
</head>
<body>
  <main class="shell">
    <section class="options" id="options">
      <label class="field">Recording quality
        <select id="quality">
          <option value="low">480p · Smaller file</option>
          <option value="standard" selected>720p · Recommended</option>
          <option value="high">1080p · High quality</option>
        </select>
      </label>
      <label class="mic"><input id="microphone" type="checkbox"> Include microphone</label>
      <button class="btn primary" id="start">Start recording</button>
    </section>
    <div class="error" id="error" role="alert"></div>
    <section class="stage">
      <div class="empty" id="empty"><strong>Ready to record</strong><p>Choose quality and microphone, then select a tab, window, or screen.<br>Chrome can also include shared tab or system audio.</p></div>
      <video id="preview" playsinline></video>
      <div class="countdown" id="countdown">3</div>
      <div class="status" id="status"><span class="dot"></span><strong>Recording</strong><span class="time" id="time">0:00</span></div>
    </section>
    <div class="actions">
      <button class="btn" id="again" hidden>Record again</button>
      <button class="btn" id="discard" hidden>Discard</button>
      <button class="btn danger" id="stop" hidden>Stop recording</button>
      <button class="btn primary" id="download" hidden>Download recording</button>
    </div>
  </main>
  <script>
    (()=>{
      const $=id=>document.getElementById(id);
      const quality={low:{width:854,height:480,bitrate:1500000},standard:{width:1280,height:720,bitrate:3000000},high:{width:1920,height:1080,bitrate:6000000}};
      let recorder,displayStream,micStream,outputStream,audioContext,chunks=[],url,timer,seconds=0,stopping=false;
      const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
      const showError=message=>{$('error').textContent=message;$('error').classList.add('show')};
      const clearError=()=>{$('error').classList.remove('show');$('error').textContent=''};
      const setTime=()=>{$('time').textContent=`${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`};
      const stopTracks=()=>{[displayStream,micStream,outputStream].filter(Boolean).forEach(stream=>stream.getTracks().forEach(track=>track.stop()));displayStream=micStream=outputStream=null;if(audioContext){audioContext.close().catch(()=>{});audioContext=null}};
      const reset=()=>{clearInterval(timer);timer=null;seconds=0;setTime();stopping=false;if(recorder&&recorder.state==='recording'){recorder.onstop=null;recorder.stop()}stopTracks();recorder=null;chunks=[];if(url){URL.revokeObjectURL(url);url=null}$('preview').removeAttribute('src');$('preview').srcObject=null;$('preview').controls=false;$('preview').muted=true;$('preview').style.display='none';$('empty').style.display='block';$('status').classList.remove('show');$('countdown').classList.remove('show');$('options').style.display='grid';$('start').disabled=false;$('stop').hidden=true;$('again').hidden=true;$('discard').hidden=true;$('download').hidden=true;clearError()};
      const combinedStream=async(display,mic)=>{
        const result=new MediaStream(display.getVideoTracks());
        const audioTracks=[...display.getAudioTracks(),...(mic?mic.getAudioTracks():[])];
        if(audioTracks.length===1){result.addTrack(audioTracks[0]);return result}
        if(audioTracks.length>1){audioContext=new AudioContext();const destination=audioContext.createMediaStreamDestination();audioTracks.forEach(track=>audioContext.createMediaStreamSource(new MediaStream([track])).connect(destination));destination.stream.getAudioTracks().forEach(track=>result.addTrack(track))}
        return result;
      };
      const finish=()=>{if(stopping)return;stopping=true;clearInterval(timer);$('status').classList.remove('show');stopTracks();const mime=recorder&&recorder.mimeType?recorder.mimeType:'video/webm';const blob=new Blob(chunks,{type:mime});if(!blob.size){showError('The browser returned an empty recording. Try another shared surface or disable shared audio.');$('empty').style.display='block';$('empty').innerHTML='<strong>No recording was captured</strong><p>Change the source or audio option and try again.</p>';$('again').hidden=false;stopping=false;return}url=URL.createObjectURL(blob);$('preview').srcObject=null;$('preview').src=url;$('preview').muted=false;$('preview').controls=true;$('preview').style.display='block';$('preview').play().catch(()=>{});$('again').hidden=false;$('discard').hidden=false;$('download').hidden=false;stopping=false};
      const stop=()=>{if(recorder&&recorder.state==='recording'){recorder.stop();$('stop').disabled=true}else if(!stopping)finish()};
      const start=async()=>{reset();clearError();$('start').disabled=true;const q=quality[$('quality').value];try{const displayOptions={video:{width:{ideal:q.width},height:{ideal:q.height},frameRate:{ideal:30,max:30}},audio:true};const displayPromise=navigator.mediaDevices.getDisplayMedia(displayOptions);const micPromise=$('microphone').checked?navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true}}):Promise.resolve(null);[displayStream,micStream]=await Promise.all([displayPromise,micPromise]);outputStream=await combinedStream(displayStream,micStream);const mime=['video/webm;codecs=vp9,opus','video/webm;codecs=vp8,opus','video/webm'].find(type=>MediaRecorder.isTypeSupported(type));recorder=new MediaRecorder(outputStream,{...(mime?{mimeType:mime}:{}),videoBitsPerSecond:q.bitrate});chunks=[];recorder.ondataavailable=event=>{if(event.data&&event.data.size)chunks.push(event.data)};recorder.onstop=finish;recorder.onerror=event=>{showError(event.error&&event.error.message?event.error.message:'The browser could not record this screen.');stopTracks()};displayStream.getVideoTracks()[0].addEventListener('ended',stop,{once:true});$('options').style.display='none';$('empty').style.display='none';$('preview').srcObject=displayStream;$('preview').muted=true;$('preview').controls=false;$('preview').style.display='block';await $('preview').play().catch(()=>{});$('countdown').classList.add('show');for(let count=3;count>0;count--){$('countdown').textContent=String(count);await wait(1000);if(!displayStream||displayStream.getVideoTracks()[0].readyState!=='live'){throw new Error('Screen sharing ended before recording started.')}}$('countdown').classList.remove('show');recorder.start(1000);seconds=0;setTime();timer=setInterval(()=>{seconds++;setTime()},1000);$('status').classList.add('show');$('stop').hidden=false;$('stop').disabled=false}catch(error){stopTracks();$('start').disabled=false;$('options').style.display='grid';$('countdown').classList.remove('show');if(error&&error.name!=='NotAllowedError')showError(error.message||'Could not start screen recording.')}};
      $('start').addEventListener('click',start);$('stop').addEventListener('click',stop);$('again').addEventListener('click',start);$('discard').addEventListener('click',reset);$('download').addEventListener('click',()=>{if(!url)return;const link=document.createElement('a');link.href=url;link.download=`LogicLearn-recording-${new Date().toISOString().replaceAll(':','-')}.webm`;link.click()});reset();
    })();
  </script>
</body>
</html>

/* ============================================================
   NeJoAta — bisedë lokale anonime pa internet (WebRTC mbi Wi-Fi lokal)
   Topologjia: YLL. Një "host" është qendra; të tjerët lidhen vetëm me host-in,
   i cili ua përcjell mesazhet. Sinjalizim DORAZI me QR (ose tekst) — pa server.
   iceServers: [] => vetëm kandidatë lokalë => punon pa internet brenda Wi-Fi-t.

   Rregull i artë i gjendjes: HYN NË BISEDË VETËM kur një kanal të dhënash HAPET
   vërtet (ose host-i zgjedh shprehimisht "pres pjesëtarë"). Asnjë skanim i
   dështuar dhe asnjë "mbrapa" nuk të fut në bisedë.
   ============================================================ */
(function () {
  "use strict";

  /* ---------- identitet i përkohshëm ---------- */
  var ADJ = ["heshtur","shpejtë","verdhë","veri","qetë","hapur","gri","kthjellët","larg","afër","ulët","ndritshëm","bli","gur","pishë","hekur","muzg","ndezur","kaltër","fushë"];
  var NOUN = ["qift","lumë","gur","fier","krie","prush","flladi","fluturë","kallam","gardalinë","rrap","bli","zog","dunë","baticë","luginë","pulëbardhë","strall","mështeknë","skifter"];
  function randHandle(){ return ADJ[(Math.random()*ADJ.length)|0]+"-"+NOUN[(Math.random()*NOUN.length)|0]+"-"+(10+(Math.random()*90|0)); }
  var me = { handle: randHandle(), id: Math.random().toString(36).slice(2)+Date.now().toString(36) };

  /* ---------- gjendja ---------- */
  var role=null;                 // "host" | "guest"
  var peersConn={};              // host: peerId -> {pc,dc,handle}; guest: {host:{pc,dc}}
  var roster={};                 // id -> handle
  var seen={}, lastSender=null;
  var pendingGuestPC=null;       // lidhja e guest-it gjatë handshake-ut
  var camStream=null, scanRAF=null, scanCb=null;
  var inChat=false;

  var $=function(id){return document.getElementById(id);};
  var V={ gate:$("gate"), role:$("roleView"), hostWait:$("hostWait"), signal:$("signalView"), app:$("app"), guide:$("guide") };
  var scroll=$("scroll"), input=$("input"), composer=$("composer"), sendBtn=$("sendBtn");
  var roomLabel=$("roomLabel"), peerCount=$("peerCount"), statusDot=$("statusDot");

  /* ---------- ndihmës ---------- */
  function hueOf(s){var h=0,i;for(i=0;i<s.length;i++)h=(h*131+s.charCodeAt(i))>>>0;return h%360;}
  function avatarColor(s){var u=hueOf(s);return "linear-gradient(135deg,hsl("+u+" 55% 46%),hsl("+((u+28)%360)+" 58% 40%))";}
  function initials(s){var p=s.split("-");return (p[0]?p[0][0]:"?").toUpperCase()+(p[1]?p[1][0]:"").toUpperCase();}
  function atBottom(){return scroll.scrollHeight-scroll.scrollTop-scroll.clientHeight<70;}
  function stick(wb){if(wb)scroll.scrollTop=scroll.scrollHeight;}
  function esc(s){return s.replace(/[&<>"]/g,function(c){return({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"})[c];});}
  function clock(ts){var d=new Date(ts);return ("0"+d.getHours()).slice(-2)+":"+("0"+d.getMinutes()).slice(-2);}

  function clearEmpty(){ var e=scroll.querySelector(".empty"); if(e)e.remove(); }
  function showEmptyIfWaiting(){
    if(role==="host" && connectedCount()===0 && !scroll.querySelector(".row") && !scroll.querySelector(".empty")){
      var d=document.createElement("div"); d.className="empty";
      d.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-5.2 6-5.2s6 1.9 6 5.2"/><path d="M17 8.5h5M19.5 6v5" opacity=".6"/></svg>'+
        '<p class="et">Po pret pjesëtarë</p><p class="ed">Shto dikë me butonin + lart djathtas. Kur të lidhet, biseda nis këtu.</p>';
      scroll.appendChild(d);
    }
  }

  function addMessage(m){
    if(m.id&&seen[m.id])return; if(m.id)seen[m.id]=1;
    clearEmpty();
    var wb=atBottom(), mine=m.from===me.id, grouped=lastSender===m.from; lastSender=m.from;
    var row=document.createElement("div");
    row.className="row"+(mine?" mine":"")+(grouped?" grouped":"");
    var av=document.createElement("div"); av.className="avatar";
    if(mine){av.style.background="var(--accent)";av.style.color="var(--accent-fg)";}
    else av.style.background=avatarColor(m.handle);
    av.textContent=initials(mine?"ti":m.handle);
    var stack=document.createElement("div"); stack.className="stack";
    var head=grouped?"":'<div class="namemeta"><span class="nm">'+esc(mine?"ti":m.handle)+'</span></div>';
    stack.innerHTML=head+'<div class="bubble">'+esc(m.text)+'</div><div class="btime">'+clock(m.ts)+'</div>';
    row.appendChild(av); row.appendChild(stack); scroll.appendChild(row); stick(wb);
  }
  function addSys(t){ var wb=atBottom(); var d=document.createElement("div"); d.className="sys"; d.innerHTML='<span class="pill">'+esc(t)+'</span>'; scroll.appendChild(d); lastSender=null; stick(wb); }

  function connectedCount(){
    if(role==="host"){ var n=0; Object.keys(peersConn).forEach(function(k){var p=peersConn[k];if(p&&p.dc&&p.dc.readyState==="open")n++;}); return n; }
    return (peersConn.host&&peersConn.host.dc&&peersConn.host.dc.readyState==="open")?1:0;
  }
  function refreshCount(){
    peerCount.textContent = Object.keys(roster).length+1;
    statusDot.className="dot"+(connectedCount()>0?" live":"");
  }

  /* ---------- kodimi i sinjalit ---------- */
  function packSignal(obj){
    var json=JSON.stringify(obj);
    try{
      var gz=pako.deflate(json), bin="",i;
      for(i=0;i<gz.length;i++) bin+=String.fromCharCode(gz[i]);
      return "M1"+btoa(bin).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
    }catch(e){ return "M0"+btoa(unescape(encodeURIComponent(json))); }
  }
  function unpackSignal(code){
    code=(code||"").trim().replace(/\s+/g,"");
    var tag=code.slice(0,2), body=code.slice(2);
    if(tag==="M1"){
      var b=atob(body.replace(/-/g,"+").replace(/_/g,"/")), arr=new Uint8Array(b.length),i;
      for(i=0;i<b.length;i++)arr[i]=b.charCodeAt(i);
      return JSON.parse(pako.inflate(arr,{to:"string"}));
    }
    if(tag==="M0") return JSON.parse(decodeURIComponent(escape(atob(body))));
    throw new Error("tag");
  }

  /* ---------- WebRTC ---------- */
  function newPC(){ return new RTCPeerConnection({ iceServers: [] }); }
  function waitIce(pc){
    return new Promise(function(res){
      if(pc.iceGatheringState==="complete")return res();
      var done=false, t=setTimeout(function(){if(!done){done=true;res();}},3000);
      pc.addEventListener("icegatheringstatechange",function(){
        if(pc.iceGatheringState==="complete"&&!done){done=true;clearTimeout(t);res();}
      });
    });
  }
  function wireDC(dc,peerId){
    dc.onopen=function(){ onPeerOpen(peerId,dc); };
    dc.onclose=function(){ onPeerClose(peerId); };
    dc.onmessage=function(ev){ onData(peerId,ev.data); };
  }
  function onPeerOpen(peerId,dc){
    if(role==="host"){
      peersConn[peerId]=peersConn[peerId]||{}; peersConn[peerId].dc=dc;
      sendOn(dc,{t:"welcome",from:me.id,handle:me.handle});
      broadcastRoster();
      enterChat(); clearEmpty(); addSys("Një pjesëtar u lidh.");
    }else{
      peersConn.host.dc=dc;
      sendOn(dc,{t:"hello",from:me.id,handle:me.handle});
      enterChat(); addSys("U lidhe me grupin.");
    }
    refreshCount();
  }
  function onPeerClose(peerId){
    if(role==="host"){ delete peersConn[peerId]; delete roster[peerId]; broadcastRoster(); if(inChat)addSys("Një pjesëtar u shkëput."); }
    else if(inChat){ addSys("U shkëpute nga host-i."); }
    refreshCount();
  }
  function sendOn(dc,obj){ try{ if(dc&&dc.readyState==="open")dc.send(JSON.stringify(obj)); }catch(e){} }

  function onData(peerId,raw){
    var m; try{m=JSON.parse(raw);}catch(e){return;}
    if(role==="host"){
      if(m.t==="hello"){ if(peersConn[peerId]){peersConn[peerId].handle=m.handle; peersConn[peerId].uid=m.from;} broadcastRoster(); return; }
      if(m.t==="msg"){ addMessage(m); relay(m,peerId); return; }
      if(m.t==="sos"){ if(!seen[m.id]){seen[m.id]=1; showSosAlert(m);} relay(m,peerId); return; }
    }else{
      if(m.t==="welcome"){ roster[m.from]=m.handle; refreshCount(); return; }
      if(m.t==="roster"){ roster={}; Object.keys(m.roster||{}).forEach(function(k){if(k!==me.id)roster[k]=m.roster[k];}); refreshCount(); return; }
      if(m.t==="msg"){ addMessage(m); return; }
      if(m.t==="sos"){ if(!seen[m.id]){seen[m.id]=1; showSosAlert(m);} return; }
    }
  }
  function relay(m,exceptId){ Object.keys(peersConn).forEach(function(pid){ if(pid!==exceptId)sendOn(peersConn[pid].dc,m); }); }
  function broadcastRoster(){
    // Lista mbahet sipas identitetit REAL të secilit (uid), jo sipas etiketës së lidhjes,
    // që çdo telefon ta njohë veten dhe të mos numërohet dy herë.
    var full={}; full[me.id]=me.handle;
    Object.keys(peersConn).forEach(function(pid){ var p=peersConn[pid]; if(p&&p.uid&&p.handle)full[p.uid]=p.handle; });
    roster={}; Object.keys(full).forEach(function(k){ if(k!==me.id)roster[k]=full[k]; });
    Object.keys(peersConn).forEach(function(pid){ sendOn(peersConn[pid].dc,{t:"roster",roster:full}); });
    refreshCount();
  }

  /* ---------- handshake ---------- */
  // GUEST krijon offer
  function guestCreateOffer(){
    if(typeof RTCPeerConnection==="undefined"){ sigBusy(""); sigMsg("Ky shfletues s'e mbështet lidhjen (WebRTC). Provo Chrome ose Safari, dhe sigurohu që faqja është me HTTPS."); return; }
    sigBusy("Po krijoj kodin…");
    var pc; try{ pc=newPC(); }catch(e){ sigMsg("S'u krijua dot lidhja. Provo sërish."); return; }
    pendingGuestPC=pc;
    var dc=pc.createDataChannel("mesh");
    peersConn.host={pc:pc}; wireDC(dc,"host");
    pc.oniceconnectionstatechange=function(){ if(pc.iceConnectionState==="failed")sigErr(); };
    pc.createOffer().then(function(o){return pc.setLocalDescription(o);})
      .then(function(){return waitIce(pc);})
      .then(function(){
        // Trego QR-në e guest-it. Skanimi i përgjigjes hapet më pas me butonin "Skano kodin e host-it →".
        showOut(packSignal({r:"offer",sdp:pc.localDescription.sdp}),
          "Trego kodin te host-i","Hapi 1/2 · host-i e skanon këtë kod. Pastaj shtyp butonin poshtë për të skanuar kodin që të kthen ai.");
      }).catch(sigErr);
  }
  function guestApplyAnswer(code){
    var sig=tryUnpack(code); if(!sig)return;
    if(sig.r!=="answer"){ sigMsg("Ky s'është kodi i duhur (prisja përgjigjen e host-it)."); rearm(); return; }
    if(!pendingGuestPC){ sigMsg("Lidhja s'është gati. Rifillo."); return; }
    pendingGuestPC.setRemoteDescription({type:"answer",sdp:sig.sdp})
      .then(function(){ sigMsg("U gjet host-i — po lidhem…"); })
      .catch(function(){ sigMsg("Kodi s'u pranua. Provo sërish."); rearm(); });
  }
  // HOST skanon offer -> krijon answer
  function hostScanOffer(){ role="host"; armScan("Skano kodin e pjesëtarit", hostApplyOffer); }
  function hostApplyOffer(code){
    var sig=tryUnpack(code); if(!sig)return;
    if(sig.r!=="offer"){ sigMsg("Ky s'është kodi i duhur (prisja kodin e pjesëtarit)."); rearm(); return; }
    sigBusy("Po krijoj përgjigjen…");
    var peerId="p"+Date.now().toString(36)+(Math.random()*1e4|0);
    var pc=newPC(); peersConn[peerId]={pc:pc};
    pc.ondatachannel=function(ev){ wireDC(ev.channel,peerId); };
    pc.oniceconnectionstatechange=function(){ if(pc.iceConnectionState==="failed"){delete peersConn[peerId];} };
    pc.setRemoteDescription({type:"offer",sdp:sig.sdp})
      .then(function(){return pc.createAnswer();})
      .then(function(a){return pc.setLocalDescription(a);})
      .then(function(){return waitIce(pc);})
      .then(function(){
        showOut(packSignal({r:"answer",sdp:pc.localDescription.sdp}),
          "Trego kodin te pjesëtari","Hapi 2/2 · pjesëtari e skanon dhe lidhja hapet vetë.", true);
      }).catch(sigErr);
  }
  function tryUnpack(code){
    try{ return unpackSignal(code); }
    catch(e){ sigMsg("Kod i pavlefshëm. Ky s'është kod NeJoAta — provo sërish."); rearm(); return null; }
  }

  /* ---------- kamera / skaner ---------- */
  function armScan(title,cb){
    scanCb=cb; openSignal(); $("sigTitle").textContent=title;
    $("outWrap").hidden=true; $("scanWrap").hidden=false; $("busyWrap").hidden=true; sigMsg("");
    startCamera();
  }
  function rearm(){ // rindiz skanerin pas një kodi të gabuar
    if(!V.signal.hidden && !$("scanWrap").hidden) startCamera();
  }
  function startCamera(){
    stopCamera();
    var video=$("scanVideo"), canvas=$("scanCanvas");
    var ctx=canvas.getContext("2d",{willReadFrequently:true});
    if(!window.isSecureContext){ video.hidden=true; $("scanHint").textContent="Kamera kërkon HTTPS. Hape faqen nga linku i Vercel (https://…), jo skedarin lokal. Ose ngjit kodin me dorë më poshtë."; return; }
    if(!navigator.mediaDevices||!navigator.mediaDevices.getUserMedia){ video.hidden=true; $("scanHint").textContent="Kamera s'disponohet në këtë shfletues. Ngjit kodin me dorë më poshtë."; return; }

    function run(stream){
      camStream=stream; video.hidden=false; video.srcObject=stream;
      video.setAttribute("playsinline","true"); video.setAttribute("autoplay","true"); video.muted=true;
      $("scanHint").textContent="Kamera aktive — drejtoje nga QR-ja në ekranin tjetër (afro/largo pak derisa ta kapë).";
      var p=video.play(); if(p&&p.catch)p.catch(function(){});
      (function tick(){
        if(!camStream)return;
        if(video.readyState>=2 && video.videoWidth){
          canvas.width=video.videoWidth; canvas.height=video.videoHeight;
          try{
            ctx.drawImage(video,0,0,canvas.width,canvas.height);
            var img=ctx.getImageData(0,0,canvas.width,canvas.height);
            var res=window.jsQR?jsQR(img.data,img.width,img.height,{inversionAttempts:"attemptBoth"}):null;
            if(res&&res.data){ var cb=scanCb; stopCamera(); if(cb)cb(res.data); return; }
          }catch(e){}
        }
        scanRAF=requestAnimationFrame(tick);
      })();
    }
    // provo kamerën e pasme; nëse dështon, provo çfarëdo kamere
    navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:"environment"}}})
      .then(run)
      .catch(function(){
        navigator.mediaDevices.getUserMedia({video:true}).then(run).catch(function(err){
          video.hidden=true;
          var name=(err&&err.name)||"";
          if(name==="NotAllowedError") $("scanHint").textContent="Kamera u bllokua. Lejo kamerën te cilësimet e faqes, ose ngjit kodin me dorë më poshtë.";
          else $("scanHint").textContent="Kamera s'u hap. Ngjit kodin me dorë më poshtë.";
        });
      });
  }
  function stopCamera(){
    if(scanRAF){cancelAnimationFrame(scanRAF);scanRAF=null;}
    if(camStream){camStream.getTracks().forEach(function(t){t.stop();});camStream=null;}
  }

  /* ---------- kodi dalës (QR + tekst) ---------- */
  function showOut(code,title,hint,hostDone){
    openSignal(); $("sigTitle").textContent=title; $("outHint").textContent=hint||"";
    $("scanWrap").hidden=true; $("busyWrap").hidden=true; $("outWrap").hidden=false; sigMsg("");
    var canvas=$("qrCanvas"); $("qrNote").textContent="";
    if(window.QRCode&&QRCode.toCanvas){
      QRCode.toCanvas(canvas,code,{width:236,margin:1,errorCorrectionLevel:"L"},function(err){
        if(err){ canvas.hidden=true; $("qrNote").textContent="Kodi është i gjatë për QR — përdor tekstin më poshtë."; }
        else canvas.hidden=false;
      });
    }else{ canvas.hidden=true; $("qrNote").textContent="Përdor tekstin më poshtë."; }
    $("codeText").value=code;
    $("outDone").hidden=!hostDone;
    $("outScanNext").hidden=!!hostDone; // guest: pas QR, kalo te skanimi i përgjigjes
  }
  function sigBusy(txt){ openSignal(); $("outWrap").hidden=true; $("scanWrap").hidden=true; $("busyWrap").hidden=false; $("busyTxt").textContent=txt||"Një moment…"; sigMsg(""); }
  function sigMsg(t){ var el=$("sigMsg"); if(el)el.textContent=t||""; }
  function sigErr(){ var b=$("busyWrap"); if(b)b.hidden=true; sigMsg("Lidhja dështoi. Sigurohu që të dy jeni në të njëjtin Wi-Fi/hotspot dhe provo sërish."); }

  /* ---------- kalimet mes ekraneve ---------- */
  function show(view){ Object.keys(V).forEach(function(k){ V[k].hidden = (V[k]!==view); }); if(view!==V.signal)stopCamera(); }
  function openGate(){ inChat=false; show(V.gate); }
  function openRole(){ show(V.role); }
  function openHostWait(){ role="host"; show(V.hostWait); }
  function openSignal(){ show(V.signal); }
  function enterChat(){
    inChat=true; show(V.app);
    roomLabel.textContent = role==="host" ? "ti je host" : "i lidhur";
    if(!enterChat._greeted){ addSys("Hyre si "+me.handle+" · mesazhet nuk ruhen"); enterChat._greeted=true; }
    refreshCount(); showEmptyIfWaiting(); input.focus();
  }

  /* ---------- dërgimi ---------- */
  function sendMsg(text){
    var m={t:"msg",id:me.id+"-"+Date.now()+"-"+(Math.random().toString(36).slice(2,6)),from:me.id,handle:me.handle,text:text,ts:Date.now()};
    addMessage(m);
    if(role==="host")relay(m,null);
    else if(peersConn.host)sendOn(peersConn.host.dc,m);
  }

  /* ---------- fshirja ---------- */
  function wipe(){
    try{ Object.keys(peersConn).forEach(function(k){var p=peersConn[k];if(!p)return;if(p.dc)try{p.dc.close();}catch(e){}if(p.pc)try{p.pc.close();}catch(e){}}); }catch(e){}
    peersConn={}; roster={}; seen={}; lastSender=null; role=null; pendingGuestPC=null; inChat=false;
    scroll.innerHTML=""; enterChat._greeted=false;
    me={ handle:randHandle(), id:Math.random().toString(36).slice(2)+Date.now().toString(36) };
    stopCamera(); openGate();
  }

  /* ---------- SOS: alarm rreziku ---------- */
  var countdownTimer=null, shakeOn=false, audioCtx=null;

  function vibrate(){ try{ if(navigator.vibrate) navigator.vibrate([300,120,300,120,400]); }catch(e){} }
  function beep(){
    try{
      audioCtx=audioCtx||new (window.AudioContext||window.webkitAudioContext)();
      if(audioCtx.state==="suspended")audioCtx.resume();
      [0,0.35,0.7].forEach(function(t){
        var o=audioCtx.createOscillator(), g=audioCtx.createGain();
        o.type="square"; o.frequency.value=880;
        o.connect(g); g.connect(audioCtx.destination);
        var s=audioCtx.currentTime+t;
        g.gain.setValueAtTime(0.0001,s); g.gain.exponentialRampToValueAtTime(0.25,s+0.02);
        g.gain.exponentialRampToValueAtTime(0.0001,s+0.25);
        o.start(s); o.stop(s+0.26);
      });
    }catch(e){}
  }

  function sendSOS(){
    var m={t:"sos",id:me.id+"-sos-"+Date.now(),from:me.id,handle:me.handle,ts:Date.now()};
    seen[m.id]=1;
    if(role==="host") relay(m,null); else if(peersConn.host) sendOn(peersConn.host.dc,m);
    // vetë dërguesi: shënim, jo banner
    if(!inChat) enterChat();
    addSys("⚠ Alarmi u dërgua te grupi.");
    try{ if(navigator.vibrate) navigator.vibrate(200); }catch(e){}
  }

  function showSosAlert(m){
    var al=$("sosAlert");
    $("sosAlertName").textContent="⚠ "+(m.from===me.id?"ti":m.handle)+" ËSHTË NË RREZIK";
    $("sosAlertTime").textContent=clock(m.ts);
    al.hidden=false;
    if(!inChat) enterChat();
    addSys("⚠ "+m.handle+" sinjalizoi RREZIK — "+clock(m.ts));
    vibrate(); beep();
  }

  function startCountdown(){
    if(countdownTimer) return; // tashmë në numërim
    var cd=$("sosCountdown"), num=$("sosNum"); var n=5; num.textContent=n; cd.hidden=false;
    try{ if(navigator.vibrate) navigator.vibrate(120); }catch(e){}
    countdownTimer=setInterval(function(){
      n--; num.textContent=n;
      if(n<=0){ clearInterval(countdownTimer); countdownTimer=null; cd.hidden=true; sendSOS(); }
    },1000);
  }
  function cancelCountdown(){ if(countdownTimer){clearInterval(countdownTimer);countdownTimer=null;} $("sosCountdown").hidden=true; }

  // zbulimi i tundjes
  var _lt=0,_lx=0,_ly=0,_lz=0,_sh=0,_lsh=0;
  function onMotion(e){
    var a=e.accelerationIncludingGravity||e.acceleration; if(!a||a.x==null)return;
    var now=Date.now(); if(now-_lt<90)return; var dt=now-_lt; _lt=now;
    var dx=a.x-_lx, dy=a.y-_ly, dz=a.z-_lz; _lx=a.x; _ly=a.y; _lz=a.z;
    var speed=Math.sqrt(dx*dx+dy*dy+dz*dz)/dt*1000;
    if(speed>1100){ if(now-_lsh<1000)_sh++; else _sh=1; _lsh=now; if(_sh>=3){ _sh=0; if(!countdownTimer) startCountdown(); } }
  }
  function setShake(on, hintEl, toggleEl){
    function apply(ok){
      shakeOn=ok; toggleEl.setAttribute("aria-pressed", ok?"true":"false");
      hintEl.textContent = ok ? "Tundja është aktive. Tund fort telefonin për të nisur alarmin." : "";
      if(ok) window.addEventListener("devicemotion", onMotion); else window.removeEventListener("devicemotion", onMotion);
    }
    if(!on){ apply(false); return; }
    if(typeof DeviceMotionEvent==="undefined"){ hintEl.textContent="Ky telefon s'e mbështet zbulimin e tundjes. Përdor butonin e alarmit."; return; }
    if(typeof DeviceMotionEvent.requestPermission==="function"){ // iOS
      DeviceMotionEvent.requestPermission().then(function(st){
        if(st==="granted") apply(true);
        else { toggleEl.setAttribute("aria-pressed","false"); hintEl.textContent="Leja për lëvizjen u refuzua. Lejoje te cilësimet, ose përdor butonin."; }
      }).catch(function(){ hintEl.textContent="S'u aktivizua dot. Përdor butonin e alarmit."; });
    } else { apply(true); }
  }

  /* ---------- lidhja e butonave ---------- */
  $("startBtn").addEventListener("click", openRole);
  $("learnBtn").addEventListener("click", function(){ V.guide.dataset.back="gate"; V.guide.hidden=false; V.guide.scrollTop=0; });

  $("roleHost").addEventListener("click", openHostWait);
  $("roleGuest").addEventListener("click", function(){ role="guest"; guestCreateOffer(); });
  $("roleBack").addEventListener("click", openGate);

  // host waiting room
  $("hwScan").addEventListener("click", hostScanOffer);
  $("hwEnter").addEventListener("click", enterChat);
  $("hwBack").addEventListener("click", openRole);

  // sinjalizimi
  $("pasteBtn").addEventListener("click", function(){
    var v=$("pasteCode").value.trim(); if(!v)return;
    stopCamera();
    if(scanCb) scanCb(v);
  });
  $("copyCode").addEventListener("click", function(){
    var ta=$("codeText");
    if(navigator.clipboard&&navigator.clipboard.writeText){
      navigator.clipboard.writeText(ta.value).then(function(){ $("copyCode").textContent="U kopjua ✓"; setTimeout(function(){$("copyCode").textContent="Kopjo kodin";},1500); }).catch(function(){ ta.focus(); ta.select(); });
    }else{ ta.focus(); ta.select(); }
  });
  $("outScanNext").addEventListener("click", function(){ armScan("Skano kodin e host-it", guestApplyAnswer); });
  $("outDone").addEventListener("click", function(){ if(connectedCount()>0||role==="host") enterChat(); });
  // "mbrapa" te sinjalizimi: kurrë në bisedë — kthehu te ekrani i duhur
  $("sigBack").addEventListener("click", function(){ stopCamera(); if(role==="host")openHostWait(); else openRole(); });

  function autoGrow(){ input.style.height="auto"; input.style.height=Math.min(input.scrollHeight,120)+"px"; }
  input.addEventListener("input", function(){ autoGrow(); sendBtn.disabled=input.value.trim().length===0; });
  input.addEventListener("keydown", function(e){ if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();composer.requestSubmit();} });
  composer.addEventListener("submit", function(e){ e.preventDefault(); var t=input.value.trim(); if(!t)return; sendMsg(t); input.value=""; autoGrow(); sendBtn.disabled=true; input.focus(); });

  $("addPeerBtn").addEventListener("click", function(){ role="host"; hostScanOffer(); });

  // SOS
  $("sosBtn").addEventListener("click", function(){ $("sosView").hidden=false; });
  $("sosBack").addEventListener("click", function(){ $("sosView").hidden=true; });
  $("sosSend").addEventListener("click", function(){ $("sosView").hidden=true; sendSOS(); });
  $("shakeToggle").addEventListener("click", function(){
    var on = this.getAttribute("aria-pressed")!=="true";
    setShake(on, $("shakeHint"), this);
  });
  $("sosCancel").addEventListener("click", cancelCountdown);
  $("sosAlertClose").addEventListener("click", function(){ $("sosAlert").hidden=true; });

  $("panicBtn").addEventListener("click", function(){ cancelCountdown(); setShake(false,$("shakeHint"),$("shakeToggle")); $("sosAlert").hidden=true; $("sosView").hidden=true; wipe(); });
  $("guideBtn").addEventListener("click", function(){ V.guide.dataset.back="app"; V.guide.hidden=false; V.guide.scrollTop=0; });
  function closeGuide(){ V.guide.hidden=true; if(V.guide.dataset.back==="app"&&inChat)V.app.hidden=false; else if(role==="host"&&!inChat)V.hostWait.hidden=false; else V.gate.hidden=false; }
  $("guideClose").addEventListener("click", closeGuide);
  $("guideDone").addEventListener("click", closeGuide);

  /* ---------- Denoncimet (video) ---------- */
  var pendingFile=null, repURLs=[], clearArmed=false;

  // Server (Supabase) nëse config-u është plotësuar; përndryshe LOKAL (IndexedDB)
  var SB=null, SERVER=false;
  (function initSB(){
    try{
      var c=window.NEJOATA_SUPABASE;
      if(c && c.url && c.anon && window.supabase && window.supabase.createClient){
        SB=window.supabase.createClient(c.url, c.anon, { auth:{ persistSession:false } });
        SERVER=true;
      }
    }catch(e){ SERVER=false; }
  })();

  function sbUpload(file, desc, loc){
    var ext=(file.name&&/\.(\w+)$/.exec(file.name)) ? RegExp.$1 : (file.type&&/\/(\w+)/.exec(file.type)?RegExp.$1:"mp4");
    var path=Date.now()+"-"+Math.random().toString(36).slice(2,8)+"."+ext;
    return SB.storage.from("videos").upload(path, file, { contentType:file.type||"video/mp4", upsert:false })
      .then(function(r){ if(r.error) throw r.error;
        var pub=SB.storage.from("videos").getPublicUrl(path);
        var url=pub.data.publicUrl;
        return SB.from("reports").insert({ video_url:url, storage_path:path, description:desc||null, location:loc||null });
      }).then(function(r){ if(r&&r.error) throw r.error; });
  }
  function sbFeed(){
    return SB.from("reports").select("*").order("created_at",{ascending:false}).limit(100)
      .then(function(r){ if(r.error) throw r.error; return r.data||[]; });
  }
  function revokeRepURLs(){ repURLs.forEach(function(u){try{URL.revokeObjectURL(u);}catch(e){}}); repURLs=[]; }
  function idbOpen(){ return new Promise(function(res,rej){ if(!window.indexedDB)return rej(new Error("no-idb"));
    var r=indexedDB.open("nejoata",1);
    r.onupgradeneeded=function(){ if(!r.result.objectStoreNames.contains("reports")) r.result.createObjectStore("reports",{keyPath:"id"}); };
    r.onsuccess=function(){res(r.result);}; r.onerror=function(){rej(r.error);}; }); }
  function repAdd(rec){ return idbOpen().then(function(db){ return new Promise(function(res,rej){ var tx=db.transaction("reports","readwrite"); tx.objectStore("reports").put(rec); tx.oncomplete=function(){res();}; tx.onerror=function(){rej(tx.error);}; }); }); }
  function repAll(){ return idbOpen().then(function(db){ return new Promise(function(res,rej){ var rq=db.transaction("reports","readonly").objectStore("reports").getAll(); rq.onsuccess=function(){res((rq.result||[]).sort(function(a,b){return b.ts-a.ts;}));}; rq.onerror=function(){rej(rq.error);}; }); }); }
  function repDel(id){ return idbOpen().then(function(db){ return new Promise(function(res){ var tx=db.transaction("reports","readwrite"); tx.objectStore("reports").delete(id); tx.oncomplete=function(){res();}; }); }); }
  function repClear(){ return idbOpen().then(function(db){ return new Promise(function(res){ var tx=db.transaction("reports","readwrite"); tx.objectStore("reports").clear(); tx.oncomplete=function(){res();}; }); }); }

  function fmtDT(ts){ var d=new Date(ts); return ("0"+d.getDate()).slice(-2)+"/"+("0"+(d.getMonth()+1)).slice(-2)+"/"+d.getFullYear()+" "+("0"+d.getHours()).slice(-2)+":"+("0"+d.getMinutes()).slice(-2); }
  function updateReportsCount(){
    var el=$("reportsCount"); if(!el)return;
    if(SERVER){ el.textContent="· feed i përbashkët"; return; }
    repAll().then(function(l){ el.textContent=l.length?("· "+l.length+(l.length===1?" e ruajtur":" të ruajtura")):""; }).catch(function(){ el.textContent=""; });
  }

  function emptyBox(txt){ return '<div class="rep-empty"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="m16 13 5.2 3V8L16 11"/><rect x="2" y="7" width="14" height="10" rx="2"/></svg><div>'+txt+'</div></div>'; }

  function renderReports(){
    if(SERVER) return renderServerFeed();
    var list=$("repList"), clearBtn=$("repClearAll"); revokeRepURLs(); list.innerHTML=""; clearArmed=false; clearBtn.textContent="Fshi të gjitha denoncimet";
    repAll().then(function(items){
      clearBtn.hidden=items.length===0;
      if(!items.length){ list.innerHTML=emptyBox("Ende s\'ke denoncime. Shto një video me butonin lart."); return; }
      items.forEach(function(it){
        var url=URL.createObjectURL(it.blob); repURLs.push(url);
        var card=document.createElement("div"); card.className="rep-card";
        var loc=it.loc?'<span class="loc">• '+esc(it.loc)+'</span>':'';
        var desc=it.desc?'<p class="desc">'+esc(it.desc)+'</p>':'';
        var name=(it.name&&/\.\w+$/.test(it.name))?it.name:("denoncim-"+it.ts+".mp4");
        card.innerHTML='<video controls playsinline preload="metadata" src="'+url+'"></video>'+
          '<div class="meta"><p class="when">'+fmtDT(it.ts)+' '+loc+'</p>'+desc+
          '<div class="acts"><button class="pub">Publiko</button><a class="exp" href="'+url+'" download="'+esc(name)+'">Eksporto</a><button class="del">Fshi</button></div></div>';
        card.querySelector(".pub").addEventListener("click", function(){ shareReport(it,name); });
        card.querySelector(".del").addEventListener("click", function(){ repDel(it.id).then(function(){ renderReports(); updateReportsCount(); }); });
        list.appendChild(card);
      });
    }).catch(function(){ list.innerHTML=emptyBox("Ruajtja s\'disponohet këtu (p.sh. dritare private)."); });
  }

  function renderServerFeed(){
    var list=$("repList"), clearBtn=$("repClearAll"); revokeRepURLs(); list.innerHTML=emptyBox("Po ngarkohet feed-i i përbashkët…"); clearBtn.hidden=true;
    sbFeed().then(function(items){
      list.innerHTML="";
      if(!items.length){ list.innerHTML=emptyBox("Ende s\'ka denoncime. Ji i pari që shton një video."); return; }
      items.forEach(function(it){
        var ts=it.created_at?Date.parse(it.created_at):Date.now();
        var card=document.createElement("div"); card.className="rep-card";
        var loc=it.location?'<span class="loc">• '+esc(it.location)+'</span>':'';
        var desc=it.description?'<p class="desc">'+esc(it.description)+'</p>':'';
        card.innerHTML='<video controls playsinline preload="metadata" src="'+esc(it.video_url)+'"></video>'+
          '<div class="meta"><p class="when">'+fmtDT(ts)+' '+loc+'</p>'+desc+
          '<div class="acts"><button class="pub">Publiko</button><a class="exp" href="'+esc(it.video_url)+'" target="_blank" rel="noopener">Hap</a></div></div>';
        card.querySelector(".pub").addEventListener("click", function(){ shareURL(it.video_url, it.description, it.location); });
        list.appendChild(card);
      });
    }).catch(function(){ list.innerHTML=emptyBox("S\'u lidh dot me feed-in. Kontrollo internetin dhe provo sërish."); });
  }

  function shareReport(it,name){
    var text=(it.desc||"Denoncim dhune")+(it.loc?(" — "+it.loc):"")+" · NeJoAta";
    try{
      var file=new File([it.blob], name, {type: it.type||"video/mp4"});
      if(navigator.canShare && navigator.canShare({files:[file]})){
        navigator.share({files:[file], title:"Denoncim dhune", text:text}).catch(function(){});
        return;
      }
      if(navigator.share){ navigator.share({title:"Denoncim dhune", text:text}).catch(function(){}); return; }
    }catch(e){}
    $("chanPanel").hidden=false; $("chanPanel").scrollIntoView({behavior:"smooth",block:"center"});
  }
  function shareURL(url, desc, loc){
    var text=(desc||"Denoncim dhune")+(loc?(" — "+loc):"")+" · NeJoAta";
    try{ if(navigator.share){ navigator.share({title:"Denoncim dhune", text:text, url:url}).catch(function(){}); return; } }catch(e){}
    $("chanPanel").hidden=false; $("chanPanel").scrollIntoView({behavior:"smooth",block:"center"});
  }

  $("chanToggle").addEventListener("click", function(){ var p=$("chanPanel"); p.hidden=!p.hidden; });
  $("reportsEntry").addEventListener("click", function(){
    $("reportsView").hidden=false; $("repForm").hidden=true; $("chanPanel").hidden=true;
    var w=$("repWarn");
    if(w){ w.innerHTML = SERVER
      ? '<b>Kujdes.</b> Këto video ngarkohen në një feed të përbashkët që e sheh kushdo — dhe rrinë në një server që mund të merret a mbyllet. Mos trego fytyra protestuesish; dhuna tregohet, njerëzit mbrohen.'
      : '<b>Kujdes.</b> Këto video ruhen vetëm në këtë telefon, edhe pa internet. <b>Eksportoji sa më shpejt</b> te një vend i sigurt dhe shmang fytyrat e protestuesve kur mundesh.'; }
    renderReports();
  });
  $("reportsClose").addEventListener("click", function(){ $("reportsView").hidden=true; revokeRepURLs(); });
  $("repAddBtn").addEventListener("click", function(){ $("repFile").click(); });
  $("repFile").addEventListener("change", function(){
    var f=this.files&&this.files[0]; if(!f)return;
    pendingFile=f;
    try{ var u=URL.createObjectURL(f); repURLs.push(u); $("repPreview").src=u; }catch(e){}
    $("repForm").hidden=false; $("repForm").scrollIntoView({behavior:"smooth",block:"center"});
  });
  $("repCancel").addEventListener("click", function(){ pendingFile=null; $("repForm").hidden=true; $("repFile").value=""; $("repDesc").value=""; $("repLoc").value=""; });
  function resetRepForm(){ pendingFile=null; $("repForm").hidden=true; $("repFile").value=""; $("repDesc").value=""; $("repLoc").value=""; $("repSave").disabled=false; $("repSave").textContent="Ruaj denoncimin"; }
  $("repSave").addEventListener("click", function(){
    if(!pendingFile)return;
    var desc=$("repDesc").value.trim(), loc=$("repLoc").value.trim();
    $("repSave").disabled=true;
    if(SERVER){
      $("repSave").textContent="Po ngarkohet…";
      sbUpload(pendingFile, desc, loc).then(function(){ resetRepForm(); renderServerFeed(); updateReportsCount(); })
        .catch(function(){ $("repSave").disabled=false; $("repSave").textContent="Ruaj denoncimin"; alertRep("S'u ngarkua dot. Kontrollo internetin / madhësinë e videos dhe provo sërish."); });
      return;
    }
    var rec={id:"r"+Date.now()+"-"+(Math.random()*1e4|0),blob:pendingFile,type:pendingFile.type||"video",name:pendingFile.name||"",desc:desc,loc:loc,ts:Date.now()};
    repAdd(rec).then(function(){ resetRepForm(); renderReports(); updateReportsCount(); })
      .catch(function(){ $("repSave").disabled=false; alertRep("S'u ruajt dot (ndoshta hapësira u mbush). Provo ta eksportosh e të fshish të vjetrat."); });
  });
  function alertRep(t){ var l=$("repList"); l.insertAdjacentHTML("afterbegin",'<div class="rep-empty" style="color:var(--danger)">'+esc(t)+'</div>'); }
  $("repClearAll").addEventListener("click", function(){
    if(!clearArmed){ clearArmed=true; this.textContent="Shtyp sërish për të fshirë TË GJITHA"; return; }
    repClear().then(function(){ renderReports(); updateReportsCount(); });
  });

  /* ---------- Listat e personalizuara (server ose lokal) ---------- */
  var LKEY="nja_lists_v1", curList=null, lDelArmed=false;
  function lsGet(){ try{ return JSON.parse(localStorage.getItem(LKEY)||"[]"); }catch(e){ return []; } }
  function lsSet(a){ try{ localStorage.setItem(LKEY, JSON.stringify(a)); }catch(e){} }

  function listsAll(){
    if(SERVER) return SB.from("lists").select("id,name,columns,created_at").order("created_at",{ascending:true}).then(function(r){ if(r.error)throw r.error; return r.data||[]; });
    return Promise.resolve(lsGet());
  }
  function listCreate(name, cols, photoIndex){
    var idx = Number(photoIndex); if(!isFinite(idx) || idx < 0) idx = null;
    if(SERVER) return SB.from("lists").insert({name:name,columns:cols,photo_index:idx}).select().then(function(r){ if(r.error)throw r.error; return r.data[0]; });
    var l={id:"l"+Date.now(),name:name,columns:cols,photo_index:idx,rows:[]}; var a=lsGet(); a.push(l); lsSet(a); return Promise.resolve(l);
  }
  function listGet(id){
    if(SERVER) return SB.from("lists").select("*").eq("id",id).single().then(function(r){ if(r.error)throw r.error; return r.data ? Object.assign({}, r.data, {photo_index: (r.data.photo_index !== undefined && r.data.photo_index !== null) ? Number(r.data.photo_index) : null}) : r.data; });
    var found = lsGet().filter(function(x){return x.id===id;})[0]; return Promise.resolve(found ? Object.assign({}, found, {photo_index: (found.photo_index !== undefined && found.photo_index !== null) ? Number(found.photo_index) : null}) : found);
  }
  function listRows(id){
    if(SERVER) return SB.from("list_rows").select("id,data,created_at").eq("list_id",id).order("created_at",{ascending:true}).then(function(r){ if(r.error)throw r.error; return r.data||[]; });
    var l=lsGet().filter(function(x){return x.id===id;})[0]; return Promise.resolve(((l&&l.rows)||[]).map(function(rw,i){return {id:"i"+i,data:rw};}));
  }
  function rowAdd(listId, dataArr){
    if(SERVER) return SB.from("list_rows").insert({list_id:listId,data:dataArr}).then(function(r){ if(r.error)throw r.error; });
    var a=lsGet(); a.forEach(function(l){ if(l.id===listId){ l.rows=l.rows||[]; l.rows.push(dataArr); } }); lsSet(a); return Promise.resolve();
  }
  function rowDel(listId, rowId){
    if(SERVER) return SB.from("list_rows").delete().eq("id",rowId).then(function(r){ if(r.error)throw r.error; });
    var a=lsGet(); a.forEach(function(l){ if(l.id===listId){ var idx=parseInt(rowId.slice(1),10); if(l.rows&&idx>=0)l.rows.splice(idx,1); } }); lsSet(a); return Promise.resolve();
  }
  function listDel(id){
    if(SERVER) return SB.from("lists").delete().eq("id",id).then(function(r){ if(r.error)throw r.error; });
    lsSet(lsGet().filter(function(x){return x.id!==id;})); return Promise.resolve();
  }

  // Realtime (vetëm në modalitet server)
  var rtRows=null, rtLists=null;
  function subscribeRows(listId){
    if(!SERVER)return;
    unsubscribeRows();
    try{
      rtRows=SB.channel("rows-"+listId)
        .on("postgres_changes",{event:"*",schema:"public",table:"list_rows",filter:"list_id=eq."+listId}, function(){ if(curList&&curList.id===listId) reloadRows(curList); })
        .subscribe();
    }catch(e){}
  }
  function unsubscribeRows(){ if(rtRows){ try{ SB.removeChannel(rtRows); }catch(e){} rtRows=null; } }
  function subscribeLists(){
    if(!SERVER)return;
    try{
      rtLists=SB.channel("lists-all")
        .on("postgres_changes",{event:"*",schema:"public",table:"lists"}, function(){ renderMyLists(); })
        .subscribe();
    }catch(e){}
  }

  function renderMyLists(){
    var box=$("myLists"); if(!box)return; box.innerHTML="";
    listsAll().then(function(lists){
      lists.forEach(function(l){
        var cols=l.columns||[];
        var photoTag=(l.photo_index !== undefined && l.photo_index !== null && l.photo_index >= 0)?' <span class="mini-tag">foto</span>':'';
        var b=document.createElement("button"); b.className="list-btn";
        b.innerHTML='<span class="li">'+esc((l.name||"?").trim().slice(0,1).toUpperCase())+'</span>'+
          '<span class="lt"><b>'+esc(l.name||"Listë")+'</b><span>'+cols.length+(cols.length===1?" kolonë":" kolona")+photoTag+'</span></span>'+
          '<svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>';
        b.addEventListener("click", function(){ openListView(l.id); });
        box.appendChild(b);
      });
    }).catch(function(){});
  }

  // Ndërtuesi
  function addColInput(val, photoIndex){
    var row=document.createElement("div"); row.className="col-row";
    var inp=document.createElement("input"); inp.type="text"; inp.placeholder="Emri i kolonës (p.sh. Emri, Data, Vendi)"; inp.maxLength=40; if(val)inp.value=val;
    var photoFlag=document.createElement("label"); photoFlag.className="photo-flag"; photoFlag.innerHTML='<input type="checkbox" class="photo-switch"'+((photoIndex!==undefined&&photoIndex!==null)?' checked':'')+'> <span>Foto</span>';
    var rm=document.createElement("button"); rm.className="rm"; rm.type="button"; rm.textContent="×";
    rm.addEventListener("click", function(){ if($("lbCols").children.length>1) row.remove(); });
    row.appendChild(inp); row.appendChild(photoFlag); row.appendChild(rm); $("lbCols").appendChild(row);
  }
  function openBuilder(){ $("lbName").value=""; $("lbCols").innerHTML=""; addColInput(""); addColInput(""); $("listBuilder").hidden=false; }

  // Pamja e listës
  function openListView(id){
    unsubscribeRows();
    curList=null; $("listView").hidden=false; $("lvTitle").textContent="Po ngarkohet…"; $("lvAddRow").innerHTML=""; $("lvTable").innerHTML=""; lDelArmed=false; $("lvDelList").textContent="Fshi këtë listë";
    listGet(id).then(function(l){
      if(!l){ $("lvTitle").textContent="Nuk u gjet"; return; }
      curList=l; $("lvTitle").textContent=l.name||"Listë";
      renderAddRow(l); reloadRows(l); subscribeRows(l.id);
    }).catch(function(){ $("lvTitle").textContent="S'u hap dot"; });
  }
  function renderAddRow(l){
    var box=$("lvAddRow"); box.innerHTML="";
    var photoIndex = Number(l.photo_index !== undefined && l.photo_index !== null ? l.photo_index : -1);
    (l.columns||[]).forEach(function(c,i){
      var lab=document.createElement("label"); lab.textContent=c; box.appendChild(lab);
      var inp=document.createElement("input"); inp.type="text"; inp.setAttribute("data-ci",i); box.appendChild(inp);
    });
    if(photoIndex >= 0){
      var photoLabel=document.createElement("label"); photoLabel.textContent="Foto (opsional)"; box.appendChild(photoLabel);
      var photoInput=document.createElement("input"); photoInput.type="file"; photoInput.accept="image/*"; photoInput.capture="environment"; photoInput.setAttribute("data-photo","1"); box.appendChild(photoInput);
    }
    var btn=document.createElement("button"); btn.className="btn-primary"; btn.textContent="Shto rresht";
    btn.addEventListener("click", function(){
      var inps=box.querySelectorAll("input[data-ci]"); var arr=[]; inps.forEach(function(x){ arr.push(x.value.trim()); });
      var photoInput=box.querySelector("input[data-photo]");
      function commit(arr){
        if(arr.every(function(v){ return !(v && String(v).trim()); }) && !(photoInput && photoInput.files && photoInput.files.length)) return;
        btn.disabled=true;
        rowAdd(curList.id, arr).then(function(){ inps.forEach(function(x){x.value="";}); if(photoInput){photoInput.value="";} btn.disabled=false; reloadRows(curList); }).catch(function(){ btn.disabled=false; });
      }
      if(photoInput && photoInput.files && photoInput.files.length){
        var file=photoInput.files[0];
        var reader=new FileReader();
        reader.onload=function(){
          if(photoIndex >= 0){
            arr.splice(photoIndex, 0, String(reader.result));
          } else {
            arr.push(String(reader.result));
          }
          commit(arr);
        };
        reader.onerror=function(){
          if(photoIndex >= 0){ arr.splice(photoIndex, 0, ""); } else { arr.push(""); }
          commit(arr);
        };
        reader.readAsDataURL(file);
        return;
      }
      if(photoIndex >= 0){ arr.splice(photoIndex, 0, ""); }
      commit(arr);
    });
    box.appendChild(btn);
  }
  function reloadRows(l){
    var t=$("lvTable");
    listRows(l.id).then(function(rows){
      var cols=l.columns||[];
      var photoIndex = Number(l.photo_index !== undefined && l.photo_index !== null ? l.photo_index : -1);
      var headCols = cols.slice();
      if(photoIndex >= 0){ headCols.splice(photoIndex, 0, "Foto"); }
      var head="<thead><tr>"+headCols.map(function(c){return "<th>"+esc(c)+"</th>";}).join("")+"<th></th></tr></thead>";
      var body="<tbody>";
      if(!rows.length){ body+='<tr><td class="tbl-empty" colspan="'+(headCols.length+1)+'">Ende s\'ka rreshta. Shtoje të parin lart.</td></tr>'; }
      else rows.forEach(function(rw){
        var d=rw.data||[];
        var cells=[];
        for(var i=0;i<cols.length;i++){
          var actualIndex = i + (photoIndex >= 0 && i >= photoIndex ? 1 : 0);
          var val=(d[actualIndex]!=null?String(d[actualIndex]):"");
          cells.push("<td>"+esc(val)+"</td>");
        }
        if(photoIndex >= 0){
          var photo = d[photoIndex] || "";
          if(photo && /^data:image\//i.test(photo)){
            cells.splice(photoIndex, 0, '<td><img class="list-thumb" src="'+esc(photo)+'" alt="Foto"></td>');
          } else {
            cells.splice(photoIndex, 0, '<td class="tbl-empty">—</td>');
          }
        }
        body+='<tr>' + cells.join("") + '<td class="del-c"><button class="rowdel" data-id="'+esc(rw.id)+'">✕</button></td></tr>';
      });
      body+="</tbody>";
      t.innerHTML=head+body;
      t.querySelectorAll(".rowdel").forEach(function(btn){ btn.addEventListener("click", function(){ rowDel(l.id, btn.getAttribute("data-id")).then(function(){ reloadRows(l); }).catch(function(){}); }); });
    }).catch(function(){ t.innerHTML='<tbody><tr><td class="tbl-empty">S\'u ngarkuan dot rreshtat.</td></tr></tbody>'; });
  }

  $("createListBtn").addEventListener("click", openBuilder);
  $("lbClose").addEventListener("click", function(){ $("listBuilder").hidden=true; });
  $("lbBack").addEventListener("click", function(){ $("listBuilder").hidden=true; });
  $("lbAddCol").addEventListener("click", function(){ addColInput(""); });
  $("lbCreate").addEventListener("click", function(){
    var name=$("lbName").value.trim();
    var cols=[]; var photoIndex=-1;
    $("lbCols").querySelectorAll(".col-row").forEach(function(row, idx){
      var input=row.querySelector("input[type='text']");
      var v=input && input.value.trim();
      if(v) cols.push(v);
      if(row.querySelector(".photo-switch") && row.querySelector(".photo-switch").checked){ photoIndex = cols.length - 1; }
    });
    if(!name){ $("lbName").focus(); return; }
    if(!cols.length){ return; }
    $("lbCreate").disabled=true; $("lbCreate").textContent="Po krijohet…";
    listCreate(name, cols, photoIndex).then(function(l){ $("lbCreate").disabled=false; $("lbCreate").textContent="Krijo listën"; $("listBuilder").hidden=true; renderMyLists(); openListView(l.id); })
      .catch(function(){ $("lbCreate").disabled=false; $("lbCreate").textContent="Krijo listën"; $("lbName").insertAdjacentHTML("afterend",''); });
  });
  $("lvClose").addEventListener("click", function(){ unsubscribeRows(); $("listView").hidden=true; });
  $("lvBack").addEventListener("click", function(){ unsubscribeRows(); $("listView").hidden=true; });
  $("lvDelList").addEventListener("click", function(){
    if(!curList)return;
    if(!lDelArmed){ lDelArmed=true; this.textContent="Shtyp sërish për të fshirë listën"; return; }
    listDel(curList.id).then(function(){ $("listView").hidden=true; renderMyLists(); }).catch(function(){});
  });

  if("serviceWorker" in navigator){ window.addEventListener("load", function(){ navigator.serviceWorker.register("./sw.js").catch(function(){}); }); }
  updateReportsCount();
  renderMyLists();
  subscribeLists();

  /* ---------- nxit instalimin si PWA (vetëm kur hapet nga shfletuesi) ---------- */
  (function installPrompt(){
    var banner=$("installBanner"), btn=$("installBtn"), iosSteps=$("installIos"), txt=$("installText"), dismiss=$("installDismiss");
    if(!banner) return;
    var deferred=null;
    function isStandalone(){
      return (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) || window.navigator.standalone === true;
    }
    function isIOS(){ return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform==="MacIntel" && navigator.maxTouchPoints>1); }
    var dismissed=false; try{ dismissed = localStorage.getItem("nja_install_dismiss")==="1"; }catch(e){}

    if(isStandalone()){ banner.hidden=true; return; } // tashmë i instaluar → s'ka nevojë

    if(!dismissed){
      banner.hidden=false;
      if(isIOS()){ iosSteps.hidden=false; } // iPhone: s'ka buton automatik, trego hapat
    }

    window.addEventListener("beforeinstallprompt", function(e){
      e.preventDefault(); deferred=e;
      banner.hidden=false; btn.hidden=false; iosSteps.hidden=true;
      txt.textContent="Tani po e hap nga shfletuesi. Shtype butonin më poshtë për ta instaluar — pastaj punon pa internet.";
    });
    btn.addEventListener("click", function(){
      if(!deferred) return;
      deferred.prompt();
      deferred.userChoice.then(function(c){ if(c&&c.outcome==="accepted"){ banner.hidden=true; } deferred=null; });
    });
    dismiss.addEventListener("click", function(){ banner.hidden=true; try{ localStorage.setItem("nja_install_dismiss","1"); }catch(e){} });
    window.addEventListener("appinstalled", function(){ banner.hidden=true; });
  })();

  openGate();
})();

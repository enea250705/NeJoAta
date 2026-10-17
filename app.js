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

  function addMessage(m){
    if(m.id&&seen[m.id])return; if(m.id)seen[m.id]=1;
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
      enterChat(); addSys("Një pjesëtar u lidh.");
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
    }else{
      if(m.t==="welcome"){ roster[m.from]=m.handle; refreshCount(); return; }
      if(m.t==="roster"){ roster={}; Object.keys(m.roster||{}).forEach(function(k){if(k!==me.id)roster[k]=m.roster[k];}); refreshCount(); return; }
      if(m.t==="msg"){ addMessage(m); return; }
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
    refreshCount(); input.focus();
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
  $("panicBtn").addEventListener("click", wipe);
  $("guideBtn").addEventListener("click", function(){ V.guide.dataset.back="app"; V.guide.hidden=false; V.guide.scrollTop=0; });
  function closeGuide(){ V.guide.hidden=true; if(V.guide.dataset.back==="app"&&inChat)V.app.hidden=false; else if(role==="host"&&!inChat)V.hostWait.hidden=false; else V.gate.hidden=false; }
  $("guideClose").addEventListener("click", closeGuide);
  $("guideDone").addEventListener("click", closeGuide);

  if("serviceWorker" in navigator){ window.addEventListener("load", function(){ navigator.serviceWorker.register("./sw.js").catch(function(){}); }); }

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

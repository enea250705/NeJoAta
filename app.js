/* ============================================================
   NeJoAta — bisedë lokale anonime pa internet (WebRTC mbi Wi-Fi lokal)
   Topologjia: YLL. Një "host" është qendra; të tjerët ("bashkohu") lidhen
   vetëm me host-in, i cili ua përcjell mesazhet njëri-tjetrit.
   Sinjalizimi bëhet DORAZI me kod QR (ose tekst) — pa server fare.
   iceServers: [] => vetëm kandidatë lokalë => punon pa internet, brenda Wi-Fi-t.
   ============================================================ */
(function () {
  "use strict";

  /* ---------- identitet i përkohshëm ---------- */
  var ADJ = ["heshtur","shpejtë","verdhë","veri","qetë","hapur","gri","kthjellët","larg","afër","ulët","ndritshëm","bli","gur","pishë","hekur","muzg","ndezur","kaltër","fushë"];
  var NOUN = ["qift","lumë","gur","fier","krie","prush","flladi","fluturë","kallam","gardalinë","rrap","bli","zog","dunë","baticë","luginë","pulëbardhë","strall","mështeknë","skifter"];
  function randHandle() {
    return ADJ[(Math.random()*ADJ.length)|0] + "-" + NOUN[(Math.random()*NOUN.length)|0] + "-" + (10+(Math.random()*90|0));
  }
  var me = { handle: randHandle(), id: Math.random().toString(36).slice(2) + Date.now().toString(36) };

  /* ---------- gjendja ---------- */
  var role = null;              // "host" | "guest"
  var peersConn = {};           // host: id -> {pc, dc, handle}; guest: {host:{pc,dc}}
  var roster = {};              // id -> handle (për numrin e pranishëm)
  var seen = {};
  var lastSender = null;
  var pendingPC = null;         // lidhja gjatë handshake-ut
  var camStream = null, scanRAF = null;

  /* ---------- elementë ---------- */
  var $ = function (id) { return document.getElementById(id); };
  var gate=$("gate"), roleView=$("roleView"), signalView=$("signalView"), app=$("app"), guide=$("guide");
  var scroll=$("scroll"), input=$("input"), composer=$("composer"), sendBtn=$("sendBtn");
  var roomLabel=$("roomLabel"), peerCount=$("peerCount"), statusDot=$("statusDot");

  /* ---------- ndihmës UI ---------- */
  function hue(s){var h=0,i;for(i=0;i<s.length;i++)h=(h*131+s.charCodeAt(i))>>>0;return h%360;}
  function avatarColor(s){var u=hue(s);return "linear-gradient(135deg,hsl("+u+" 55% 46%),hsl("+((u+28)%360)+" 58% 40%))";}
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
  function addSys(t){
    var wb=atBottom(); var d=document.createElement("div"); d.className="sys";
    d.innerHTML='<span class="pill">'+esc(t)+'</span>'; scroll.appendChild(d); lastSender=null; stick(wb);
  }
  function refreshCount(){
    var n=Object.keys(roster).length+1;
    peerCount.textContent=n;
    var anyLive = (role==="host") ? Object.keys(peersConn).length>0 : !!(peersConn.host&&peersConn.host.dc&&peersConn.host.dc.readyState==="open");
    statusDot.className="dot"+(anyLive?" live":"");
  }

  /* ---------- kodimi i sinjalit (kompresim + base64url) ---------- */
  function packSignal(obj){
    var json=JSON.stringify(obj);
    try{
      var gz=pako.deflate(json);
      var bin=""; for(var i=0;i<gz.length;i++) bin+=String.fromCharCode(gz[i]);
      return "M1"+btoa(bin).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
    }catch(e){ return "M0"+btoa(unescape(encodeURIComponent(json))); }
  }
  function unpackSignal(code){
    code=(code||"").trim();
    var tag=code.slice(0,2), body=code.slice(2);
    if(tag==="M1"){
      var b=atob(body.replace(/-/g,"+").replace(/_/g,"/"));
      var arr=new Uint8Array(b.length); for(var i=0;i<b.length;i++)arr[i]=b.charCodeAt(i);
      return JSON.parse(pako.inflate(arr,{to:"string"}));
    }
    if(tag==="M0") return JSON.parse(decodeURIComponent(escape(atob(body))));
    throw new Error("Kod i panjohur");
  }

  /* ---------- WebRTC: lidhje lokale (pa internet) ---------- */
  function newPC(){
    // pa STUN/TURN => vetëm kandidatë lokalë (host/mDNS) => punon brenda Wi-Fi-t pa internet
    return new RTCPeerConnection({ iceServers: [] });
  }
  function waitIce(pc){
    return new Promise(function(res){
      if(pc.iceGatheringState==="complete")return res();
      var t=setTimeout(res,2500); // mos prit pafund
      pc.onicegatheringstatechange=function(){ if(pc.iceGatheringState==="complete"){clearTimeout(t);res();} };
    });
  }

  function wireDataChannel(dc, peerId){
    dc.onopen=function(){ onPeerOpen(peerId, dc); };
    dc.onclose=function(){ onPeerClose(peerId); };
    dc.onmessage=function(ev){ onData(peerId, ev.data); };
  }

  function onPeerOpen(peerId, dc){
    if(role==="host"){
      peersConn[peerId]=peersConn[peerId]||{}; peersConn[peerId].dc=dc;
      // dërgo të porsaardhurit identitetin tënd + rosterin
      sendTo(dc,{t:"welcome",from:me.id,handle:me.handle});
      broadcastRoster();
      addSys("Një pjesëtar u lidh.");
    }else{
      peersConn.host.dc=dc;
      sendTo(dc,{t:"hello",from:me.id,handle:me.handle});
      enterChat();
      addSys("U lidhe me grupin.");
    }
    refreshCount();
  }
  function onPeerClose(peerId){
    if(role==="host"){ delete peersConn[peerId]; delete roster[peerId]; broadcastRoster(); addSys("Një pjesëtar u shkëput."); }
    else { addSys("U shkëpute nga host-i."); }
    refreshCount();
  }

  function sendTo(dc,obj){ try{ if(dc&&dc.readyState==="open") dc.send(JSON.stringify(obj)); }catch(e){} }

  function onData(peerId, raw){
    var m; try{ m=JSON.parse(raw); }catch(e){ return; }

    if(role==="host"){
      if(m.t==="hello"){ roster[m.from]=m.handle; if(peersConn[peerId])peersConn[peerId].handle=m.handle; broadcastRoster(); return; }
      if(m.t==="msg"){
        addMessage(m);               // shfaqe te host-i
        relay(m, peerId);            // përcille te spoke-t e tjerë
        return;
      }
    } else {
      if(m.t==="welcome"){ roster[m.from]=m.handle; refreshCount(); return; }
      if(m.t==="roster"){ roster=m.roster||{}; delete roster[me.id]; refreshCount(); return; }
      if(m.t==="msg"){ addMessage(m); return; }
    }
  }

  // host përcjell një mesazh te të gjithë spoke-t përveç dërguesit
  function relay(m, exceptId){
    Object.keys(peersConn).forEach(function(pid){
      if(pid===exceptId)return;
      sendTo(peersConn[pid].dc, m);
    });
  }
  function broadcastRoster(){
    var full={}; full[me.id]=me.handle;
    Object.keys(peersConn).forEach(function(pid){ if(peersConn[pid].handle) full[pid]=peersConn[pid].handle; });
    roster={}; Object.keys(full).forEach(function(k){ if(k!==me.id) roster[k]=full[k]; });
    Object.keys(peersConn).forEach(function(pid){ sendTo(peersConn[pid].dc,{t:"roster",roster:full}); });
    refreshCount();
  }

  /* ---------- rrjedha e sinjalizimit (handshake me QR) ----------
     GUEST fillon: krijon OFFER -> QR.  HOST skanon offer -> krijon ANSWER -> QR.
     GUEST skanon answer -> lidhja hapet.
  ------------------------------------------------------------------ */

  // GUEST: krijo offer
  function guestCreateOffer(){
    var peerId="host";
    var pc=newPC(); pendingPC=pc;
    var dc=pc.createDataChannel("mesh");
    peersConn.host={pc:pc}; wireDataChannel(dc,peerId);
    pc.oniceconnectionstatechange=function(){ if(pc.iceConnectionState==="failed")showSignalError(); };
    pc.createOffer().then(function(o){return pc.setLocalDescription(o);})
      .then(function(){return waitIce(pc);})
      .then(function(){
        var code=packSignal({r:"offer",sdp:pc.localDescription.sdp});
        showOutgoing(code,"Trego këtë te HOST-i","Hapi 1 nga 2 · host-i e skanon këtë, pastaj të kthen një kod.");
        prepareScan("Skano kodin e host-it", function(scanned){ guestApplyAnswer(scanned); });
      }).catch(showSignalError);
  }
  function guestApplyAnswer(code){
    var sig; try{ sig=unpackSignal(code); }catch(e){ return toast("Kod i pavlefshëm"); }
    if(sig.r!=="answer")return toast("Prisja një kod përgjigjeje");
    pendingPC.setRemoteDescription({type:"answer",sdp:sig.sdp})
      .then(function(){ toast("U lidh — pak sekonda…"); })
      .catch(showSignalError);
  }

  // HOST: skano offer -> krijo answer
  function hostScanOffer(){
    role="host";
    prepareScan("Skano kodin e pjesëtarit", function(code){ hostApplyOffer(code); });
  }
  function hostApplyOffer(code){
    var sig; try{ sig=unpackSignal(code); }catch(e){ return toast("Kod i pavlefshëm"); }
    if(sig.r!=="offer")return toast("Prisja një kod ftese");
    var peerId="p"+Date.now().toString(36)+(Math.random()*1e4|0);
    var pc=newPC();
    peersConn[peerId]={pc:pc};
    pc.ondatachannel=function(ev){ wireDataChannel(ev.channel,peerId); };
    pc.oniceconnectionstatechange=function(){ if(pc.iceConnectionState==="failed"){delete peersConn[peerId];} };
    pc.setRemoteDescription({type:"offer",sdp:sig.sdp})
      .then(function(){return pc.createAnswer();})
      .then(function(a){return pc.setLocalDescription(a);})
      .then(function(){return waitIce(pc);})
      .then(function(){
        var out=packSignal({r:"answer",sdp:pc.localDescription.sdp});
        enterChat(); // host hyn menjëherë në bisedë
        showOutgoing(out,"Trego këtë te pjesëtari","Hapi 2 nga 2 · pjesëtari e skanon dhe lidhja hapet.", true);
      }).catch(showSignalError);
  }

  /* ---------- skaneri i QR (kamera) ---------- */
  function prepareScan(label, cb){
    openSignalView();
    $("sigTitle").textContent=label;
    $("scanWrap").hidden=false; $("outWrap").hidden=true;
    startCamera(cb);
  }
  function startCamera(cb){
    stopCamera();
    var video=$("scanVideo"), canvas=$("scanCanvas"), ctx=canvas.getContext("2d");
    navigator.mediaDevices.getUserMedia({video:{facingMode:"environment"}}).then(function(s){
      camStream=s; video.srcObject=s; video.setAttribute("playsinline","true"); video.play();
      (function tick(){
        if(!camStream)return;
        if(video.readyState===video.HAVE_ENOUGH_DATA){
          canvas.width=video.videoWidth; canvas.height=video.videoHeight;
          ctx.drawImage(video,0,0,canvas.width,canvas.height);
          var img=ctx.getImageData(0,0,canvas.width,canvas.height);
          var res=window.jsQR?jsQR(img.data,img.width,img.height):null;
          if(res&&res.data){ stopCamera(); cb(res.data); return; }
        }
        scanRAF=requestAnimationFrame(tick);
      })();
    }).catch(function(){
      // pa kamerë: fsheh skanerin, lër vetëm ngjitjen e kodit
      $("scanVideo").hidden=true;
      $("scanHint").textContent="Kamera s'u hap. Ngjit kodin me dorë më poshtë.";
    });
  }
  function stopCamera(){
    if(scanRAF){cancelAnimationFrame(scanRAF);scanRAF=null;}
    if(camStream){camStream.getTracks().forEach(function(t){t.stop();});camStream=null;}
    var v=$("scanVideo"); if(v){v.hidden=false;}
  }

  /* ---------- paraqitja e kodit dalës (QR + tekst) ---------- */
  function showOutgoing(code, title, hint, hostDone){
    openSignalView();
    $("sigTitle").textContent=title;
    $("outHint").textContent=hint||"";
    $("scanWrap").hidden=true; $("outWrap").hidden=false;
    var box=$("qrBox"); box.innerHTML="";
    try{
      new QRCode(box,{text:code,width:232,height:232,correctLevel:QRCode.CorrectLevel.L});
      $("qrNote").textContent="";
    }catch(e){
      $("qrNote").textContent="Kodi është i gjatë për QR — përdor tekstin më poshtë.";
    }
    $("codeText").value=code;
    // nëse host-i tashmë hyri, jep buton "mbaro"
    $("outDone").hidden=!hostDone;
  }

  function toast(t){ addSysToSignal(t); }
  function addSysToSignal(t){ var el=$("sigMsg"); if(el){el.textContent=t;} }
  function showSignalError(){ addSysToSignal("Lidhja dështoi. Sigurohu që të dy jeni në të njëjtin Wi-Fi/hotspot dhe provo sërish."); }

  /* ---------- kalimet mes ekraneve ---------- */
  function openRole(){ hideAll(); roleView.hidden=false; }
  function openSignalView(){ hideAll(); signalView.hidden=false; }
  function enterChat(){
    hideAll(); app.hidden=false;
    roomLabel.textContent = role==="host" ? "ti je host" : "i lidhur";
    if(!enterChat._greeted){ addSys("Hyre si "+me.handle+" · mesazhet nuk ruhen"); enterChat._greeted=true; }
    refreshCount(); input.focus();
  }
  function hideAll(){ gate.hidden=true; roleView.hidden=true; signalView.hidden=true; app.hidden=true; guide.hidden=true; stopCamera(); }

  /* ---------- dërgimi i mesazheve ---------- */
  function sendMsg(text){
    var m={t:"msg",id:me.id+"-"+Date.now()+"-"+(Math.random().toString(36).slice(2,6)),from:me.id,handle:me.handle,text:text,ts:Date.now()};
    addMessage(m);
    if(role==="host"){ relay(m,null); }
    else if(peersConn.host){ sendTo(peersConn.host.dc,m); }
  }

  /* ---------- fshirja / paniku ---------- */
  function wipe(){
    try{
      Object.keys(peersConn).forEach(function(k){
        var p=peersConn[k]; if(!p)return;
        if(p.dc)try{p.dc.close();}catch(e){}
        if(p.pc)try{p.pc.close();}catch(e){}
      });
    }catch(e){}
    peersConn={}; roster={}; seen={}; lastSender=null; role=null; pendingPC=null;
    scroll.innerHTML=""; enterChat._greeted=false;
    me={ handle:randHandle(), id:Math.random().toString(36).slice(2)+Date.now().toString(36) };
    stopCamera(); openGate();
  }
  function openGate(){ hideAll(); gate.hidden=false; }

  /* ---------- lidhja e butonave ---------- */
  $("startBtn").addEventListener("click", openRole);
  $("learnBtn").addEventListener("click", openGuideScreen);
  $("roleHost").addEventListener("click", function(){ role="host"; hostScanOffer(); });
  $("roleGuest").addEventListener("click", function(){ role="guest"; guestCreateOffer(); });
  $("roleBack").addEventListener("click", openGate);

  $("pasteBtn").addEventListener("click", function(){
    var v=$("pasteCode").value.trim(); if(!v)return;
    stopCamera();
    if(role==="host") hostApplyOffer(v); else guestApplyAnswer(v);
  });
  $("copyCode").addEventListener("click", function(){
    var ta=$("codeText");
    if(navigator.clipboard&&navigator.clipboard.writeText){
      navigator.clipboard.writeText(ta.value).then(function(){ $("copyCode").textContent="U kopjua ✓"; setTimeout(function(){$("copyCode").textContent="Kopjo kodin";},1500); })
        .catch(function(){ ta.select(); });
    }else{ ta.select(); }
  });
  $("outDone").addEventListener("click", enterChat);
  $("sigBack").addEventListener("click", function(){ stopCamera(); role==="host"?enterChat():openRole(); });

  function autoGrow(){ input.style.height="auto"; input.style.height=Math.min(input.scrollHeight,120)+"px"; }
  input.addEventListener("input", function(){ autoGrow(); sendBtn.disabled=input.value.trim().length===0; });
  input.addEventListener("keydown", function(e){ if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();composer.requestSubmit();} });
  composer.addEventListener("submit", function(e){
    e.preventDefault(); var t=input.value.trim(); if(!t)return;
    sendMsg(t); input.value=""; autoGrow(); sendBtn.disabled=true; input.focus();
  });

  // host mund të shtojë persona të tjerë pa prishur bisedën
  $("addPeerBtn").addEventListener("click", function(){ hostScanOffer(); });

  $("panicBtn").addEventListener("click", wipe);
  $("guideBtn").addEventListener("click", openGuideScreen);
  $("guideClose").addEventListener("click", closeGuide);
  $("guideDone").addEventListener("click", closeGuide);
  function openGuideScreen(){ var back=app.hidden; guide.hidden=false; guide.dataset.back=back?"gate":"app"; guide.scrollTop=0; }
  function closeGuide(){ guide.hidden=true; if(guide.dataset.back==="app"&&role) app.hidden=false; else gate.hidden=false; }

  /* ---------- regjistro service worker ---------- */
  if("serviceWorker" in navigator){
    window.addEventListener("load", function(){ navigator.serviceWorker.register("./sw.js").catch(function(){}); });
  }

  openGate();
})();

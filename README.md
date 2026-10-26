# NeJoAta — PWA lokale pa internet

Bisedë anonime telefon-me-telefon që punon **pa internet**, mbi një Wi-Fi/hotspot lokal.
Lidhja bëhet me WebRTC; çiftimi me kod QR; pa server, pa llogari, asgjë e ruajtur.

## Skedarët
- `index.html` — ndërfaqja (dizajni, ekranet, udhëzuesi)
- `app.js` — logjika (WebRTC lokal, QR, host/bashkohu, relay, fshirje)
- `sw.js` — service worker (hapet pa internet pas instalimit të parë)
- `manifest.webmanifest` — që të instalohet në home screen
- `icons/` — ikonat e app-it (favicon.svg/.ico, PWA, apple-touch, og-image)
- `brand/` — logo NeJoAta në SVG: horizontal, kompakt, ikonë, wordmark; secili në ngjyrë, `-on-dark`, `-black`, `-white`

## Si ta vësh online (një herë, me internet)
Duhet **HTTPS** që PWA + kamera + WebRTC të punojnë. Më e lehta: Vercel.

```bash
npm i -g vercel
cd meshline-pwa
vercel        # ndiq udhëzimet; të jep një link https://...
```
Ose: ngarko dosjen në çdo host statik me HTTPS (Netlify, Cloudflare Pages, GitHub Pages).
Për provë lokale me HTTPS mund të përdorësh `npx serve` pas një tuneli, ose host-in e zgjedhur.

## Si ta instalojnë njerëzit
1. Hap linkun në telefon (me internet, vetëm herën e parë).
2. iPhone (Safari): *Share → Add to Home Screen*. Android (Chrome): *Install app*.
3. Pas kësaj hapet si app dhe punon pa internet.

## Si të flitet pa internet (në terren)
1. Njëri ndez **hotspot** me **të dhënat celulare FIKUR** → Wi-Fi lokal, zero internet.
2. Të gjithë lidhen në atë hotspot (ose në një Wi-Fi vendi).
3. Hapni app-in. Një person zgjedh **Krijo dhomën (host)**.
4. Të tjerët zgjedhin **Bashkohu**: shfaqin kodin QR → host-i e skanon → host-i shfaq një kod → ata e skanojnë.
5. Flisni. Host-i i përcjell mesazhet mes të gjithëve.

## Kufijtë (ndershmërisht)
- Kërkon një **Wi-Fi/hotspot të përbashkët**. Bluetooth i pastër mes telefonave s'bëhet në web.
- Topologjia është **yll**: nëse host-i del, dhoma shuhet (të tjerët duhet të rinisin me një host të ri).
- Çiftimi me QR për grupe të mëdha është i ngadaltë (një nga një).
- Nuk është audituar. Për rrezik serioz nga shteti, përdor **Briar**.
- Siguria vjen nga **kush skanon kodin** — çifto vetëm me njerëz që i njeh në person.

## Provoje shpejt (2 pajisje ose 2 skeda)
Hape në dy telefona në të njëjtin Wi-Fi: njëri host, tjetri bashkohet. Shkëmbeni dy kodet QR.

## Identiteti vizual
- **Simboli:** një faqe e hapur (gazetaria, transparenca) që në anën e djathtë kthehet në dy pendë të kuqe — krah i abstraktuar dhe sinjal që ngjitet. Pa stemë, pa shqiponjë të drejtpërdrejtë.
- **Wordmark:** Inter Display Bold i kthyer në vektor; “A” ka shiritin e mesit të pjerrët në të kuqe, në të njëjtin kënd me pendët.
- **Ngjyrat:** qymyr `#171717`, e bardhë `#FFFFFF`, gri `#F3F4F6`, e kuqja `#C8102E` vetëm si theks.
- Në sfond të errët përdor skedarët `-on-dark` (pllaka e bardhë) ose `-white` (njëngjyrëshe).

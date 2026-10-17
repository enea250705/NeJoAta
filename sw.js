/* Meshline service worker — bën që app-i të hapet pa internet.
   Strategji: cache-first për skedarët e app-it. Ndërro CACHE kur përditëson. */
var CACHE = "meshline-v1";
var ASSETS = [
  "./",
  "./index.html",
  "./app.js",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/maskable-512.png",
  "./icons/apple-touch-icon.png",
  // librari të jashtme — ruhen në instalim që të punojnë offline më pas
  "https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/jsQR/1.4.0/jsQR.js",
  "https://cdnjs.cloudflare.com/ajax/libs/pako/2.1.0/pako.min.js"
];

self.addEventListener("install", function (e) {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE).then(function (c) {
      // shto një nga një që një URL e dështuar të mos prishë gjithçka
      return Promise.all(ASSETS.map(function (u) {
        return c.add(u).catch(function () { return null; });
      }));
    })
  );
});

self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) { if (k !== CACHE) return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;
  e.respondWith(
    caches.match(req).then(function (hit) {
      if (hit) return hit;
      return fetch(req).then(function (res) {
        // ruaj kopje të re nëse mundemi (për vizitën e parë me internet)
        try {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy).catch(function(){}); });
        } catch (err) {}
        return res;
      }).catch(function () {
        // offline dhe pa cache: për navigime kthe index-in
        if (req.mode === "navigate") return caches.match("./index.html");
        return new Response("", { status: 504 });
      });
    })
  );
});

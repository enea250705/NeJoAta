/* NeJoAta service worker — bën që app-i të hapet pa internet.
   Strategji: NETWORK-FIRST për skedarët e app-it (gjithmonë merr versionin e ri kur ka internet),
   me kthim te cache-i kur s'ka internet (offline punon njësoj). Gjithçka lokale, pa thirrje jashtë. */
var CACHE = "nejoata-v3";
var ASSETS = [
  "./","./index.html","./app.js","./manifest.webmanifest",
  "./lib/pako.min.js","./lib/jsQR.js","./lib/qrcode.min.js",
  "./icons/icon-192.png","./icons/icon-512.png","./icons/maskable-512.png","./icons/apple-touch-icon.png"
];

self.addEventListener("install", function (e) {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(function (c) {
    return Promise.all(ASSETS.map(function (u) { return c.add(u).catch(function () { return null; }); }));
  }));
});

self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.map(function (k) { if (k !== CACHE) return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;
  // network-first: provo rrjetin, ruaj kopjen e re; nëse s'ka rrjet, kthehu te cache-i
  e.respondWith(
    fetch(req).then(function (res) {
      try { var copy = res.clone(); caches.open(CACHE).then(function (c) { c.put(req, copy).catch(function(){}); }); } catch (err) {}
      return res;
    }).catch(function () {
      return caches.match(req).then(function (hit) {
        if (hit) return hit;
        if (req.mode === "navigate") return caches.match("./index.html");
        return new Response("", { status: 504 });
      });
    })
  );
});

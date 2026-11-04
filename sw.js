const VERSION = "v5";
const CACHE = `kinetics-quiz-${VERSION}`;
const REMINDER_CACHE = "kinetics-reminder-v1";
const REMINDER_KEY = "./reminder-state.json";
const ASSETS = ["./", "./index.html", "./manifest.webmanifest", "./icon-192.png", "./icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(ASSETS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE && key !== REMINDER_CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  if (new URL(request.url).origin !== self.location.origin) return;

  // Navigations go to the network first so a new build appears immediately,
  // then fall back to the offline copy.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(() => caches.match(request).then((cached) => cached || caches.match("./index.html"))),
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(() => caches.match("./index.html"));
    }),
  );
});

function localDay(date = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

async function readReminderState() {
  try {
    const cache = await caches.open(REMINDER_CACHE);
    const response = await cache.match(REMINDER_KEY);
    return response ? await response.json() : null;
  } catch {
    return null;
  }
}

async function saveReminderState(state) {
  try {
    const cache = await caches.open(REMINDER_CACHE);
    await cache.put(
      new Request(REMINDER_KEY),
      new Response(JSON.stringify(state), { headers: { "Content-Type": "application/json" } }),
    );
  } catch {
    /* cache unavailable */
  }
}

async function showReminder(state) {
  const left = Number(state.left) || 5;
  const streak = Number(state.streak) || 0;
  const title = left <= 1 ? "One card left. That is it." : "5 cards. 60 seconds.";
  const body =
    left <= 1
      ? `One card and today is done.${streak > 0 ? ` Keep your ${streak}-day streak.` : ""}`
      : `${left} cards left today. One minute, then you're done.${
          streak > 0 ? ` Your ${streak}-day streak is waiting.` : " Start your streak today."
        }`;
  await self.registration.showNotification(title, {
    body,
    icon: "./icon-192.png",
    badge: "./icon-192.png",
    tag: "kinetics-daily",
    renotify: true,
    requireInteraction: true,
    vibrate: [200, 100, 200, 100, 400],
    actions: [
      { action: "start", title: "Start 5 cards", icon: "./icon-192.png" },
      { action: "later", title: "Later" },
    ],
    data: { url: "./?daily=1" },
    silent: false,
  });
}

self.addEventListener("periodicsync", (event) => {
  if (event.tag !== "kinetics-daily") return;
  event.waitUntil(
    (async () => {
      const state = await readReminderState();
      if (!state || !state.enabled || state.done) return;
      const now = new Date();
      const today = localDay(now);
      if (state.lastNotified === today) return;
      const [hours, minutes] = String(state.time || "19:00").split(":").map(Number);
      const nowMinutes = now.getHours() * 60 + now.getMinutes();
      if (nowMinutes < (hours || 19) * 60 + (minutes || 0)) return;
      await showReminder(state);
      await saveReminderState({ ...state, lastNotified: today, updatedAt: Date.now() });
    })().catch(() => {
      /* a missed background reminder must never break the app */
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  if (event.action === "later") return;
  const target = new URL("./?daily=1", self.registration.scope).href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of windows) {
        if ("navigate" in client) {
          await client.navigate(target);
          return client.focus();
        }
      }
      return self.clients.openWindow(target);
    })(),
  );
});

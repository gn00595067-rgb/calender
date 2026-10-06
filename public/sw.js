/* ExecCal 推播用 Service Worker：收到推播就跳系統通知，點通知回到行事曆。 */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: event.data ? event.data.text() : "行程提醒" };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || "行程提醒", {
      body: data.body || "",
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      // 同一筆行程只留一則（網頁開著時的瀏覽器通知用同一個 tag，不會重複）
      tag: data.tag || undefined,
      data: { url: data.url || "/calendar" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/calendar";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if ("focus" in c) {
          c.navigate(url);
          return c.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});

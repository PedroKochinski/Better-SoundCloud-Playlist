(() => {
  if (window.__betterSoundCloudPageBridge) {
    return;
  }
  window.__betterSoundCloudPageBridge = true;
  const originalFetch = window.fetch.bind(window);

  function requestUrl(resource) {
    if (resource && resource.url) {
      return resource.url;
    }
    return String(resource || "");
  }

  function requestMethod(resource, init) {
    return (init && init.method) || (resource && resource.method) || "GET";
  }

  async function requestBody(resource, init) {
    if (init && init.body) {
      return String(init.body);
    }
    if (resource && typeof resource.clone === "function") {
      try {
        return await resource.clone().text();
      } catch (_error) {
        return "";
      }
    }
    return "";
  }

  window.fetch = async (resource, init) => {
    const url = requestUrl(resource);
    const method = requestMethod(resource, init).toUpperCase();
    const shouldCapture = /^https:\/\/api-v2\.soundcloud\.com\/playlists\/[^/?]+/.test(url)
      && ["POST", "PUT", "PATCH"].includes(method);
    const bodyPromise = shouldCapture ? requestBody(resource, init) : Promise.resolve("");
    const response = await originalFetch(resource, init);

    if (shouldCapture && response.ok) {
      bodyPromise.then((body) => {
        window.postMessage({
          source: "bsc-native-playlist-payload",
          method,
          url,
          status: response.status,
          body
        }, "*");
      });
    }

    return response;
  };

  window.addEventListener("message", async (event) => {
    const message = event.data;
    if (event.source !== window || !message || message.source !== "bsc-page-fetch") {
      return;
    }

    const init = {
      method: message.method || "GET",
      credentials: "include",
      headers: {
        "Accept": "application/json, text/javascript, */*; q=0.01",
        "Content-Type": "application/json",
        "Device-Locale": navigator.language || "pt-BR",
        "X-Request-Id": crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + "-" + Math.random()
      }
    };

    if (message.clientId) {
      init.headers["X-Client-Id"] = message.clientId;
    }
    if (message.authorization) {
      init.headers.Authorization = message.authorization;
    }
    if (message.body) {
      init.body = JSON.stringify(message.body);
    }
    const bodySent = init.body || "";

    try {
      const response = await originalFetch(message.url, init);
      const text = await response.text();
      window.postMessage({
        source: "bsc-page-fetch-result",
        id: message.id,
        ok: response.ok,
        status: response.status,
        method: init.method,
        url: message.url,
        bodySent,
        text
      }, "*");
    } catch (error) {
      window.postMessage({
        source: "bsc-page-fetch-result",
        id: message.id,
        error: error.message || String(error)
      }, "*");
    }
  });
})();

const MINI_PLAYER_STYLES = `
  :root {
    --accent: #83b7d2;
    --accent-rgb: 131, 183, 210;
    color-scheme: dark;
    font-family: "Helvetica Neue", "Segoe UI Variable", "SF Pro Display", Arial, sans-serif;
  }

  * { box-sizing: border-box; }
  html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; background: #090b0d; }
  button { font: inherit; }

  .mini-player {
    position: relative;
    width: 100%;
    height: 100%;
    min-width: 270px;
    min-height: 180px;
    overflow: hidden;
    color: #f8f8f4;
    background: #111416;
  }

  .mini-player video,
  .mini-poster,
  .mini-wash { position: absolute; inset: 0; width: 100%; height: 100%; }

  .mini-player video {
    object-fit: cover;
    object-position: var(--video-position, 50% 50%);
    transform: scale(var(--video-scale, 1.06));
    filter: saturate(.82) contrast(1.08) brightness(.68);
  }

  .mini-poster {
    background-position: var(--video-position, 50% 50%);
    background-size: cover;
    filter: saturate(.78) brightness(.64);
  }

  .mini-wash {
    background:
      radial-gradient(circle at 76% 18%, rgba(var(--accent-rgb), .16), transparent 42%),
      linear-gradient(180deg, rgba(5, 7, 8, .18), rgba(5, 7, 8, .76));
  }

  .mini-glass {
    position: absolute;
    inset: 10px;
    display: grid;
    grid-template-rows: auto 1fr auto;
    gap: 8px;
    padding: 12px;
    border: 1px solid rgba(255, 255, 255, .18);
    border-radius: 22px;
    background: linear-gradient(145deg, rgba(24, 27, 29, .76), rgba(10, 13, 15, .66));
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, .12), 0 16px 44px rgba(0, 0, 0, .28);
    backdrop-filter: blur(22px) saturate(145%);
    -webkit-backdrop-filter: blur(22px) saturate(145%);
  }

  .mini-head,
  .mini-controls { display: flex; align-items: center; justify-content: space-between; gap: 8px; }

  .mini-head {
    min-height: 38px;
    padding: 4px 4px 4px 12px;
    border: 1px solid rgba(255, 255, 255, .13);
    border-radius: 999px;
    background: linear-gradient(145deg, rgba(42, 46, 49, .7), rgba(12, 15, 17, .58));
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, .11), 0 8px 24px rgba(0, 0, 0, .16);
    backdrop-filter: blur(14px) saturate(140%);
    -webkit-backdrop-filter: blur(14px) saturate(140%);
  }

  .mini-brand {
    font-size: 10px;
    font-weight: 710;
    letter-spacing: .18em;
    text-shadow: 0 1px 0 rgba(255, 255, 255, .16), 0 3px 8px rgba(0, 0, 0, .38);
  }
  .mini-brand i { color: var(--accent); font-style: normal; }

  .mini-close,
  .mini-control {
    display: grid;
    place-items: center;
    border: 1px solid rgba(255, 255, 255, .14);
    border-radius: 999px;
    color: rgba(255, 255, 255, .82);
    background: rgba(18, 21, 23, .76);
    cursor: pointer;
    transition: transform 180ms ease, background 180ms ease, border-color 180ms ease;
  }

  .mini-close {
    width: 30px;
    height: 30px;
    flex: 0 0 30px;
    padding: 0;
    color: rgba(255, 255, 255, .9);
    background: linear-gradient(145deg, rgba(255, 255, 255, .14), rgba(12, 15, 17, .78));
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, .14), 0 6px 16px rgba(0, 0, 0, .18);
  }
  .mini-close svg {
    display: block;
    width: 13px;
    height: 13px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.9;
    stroke-linecap: round;
  }
  .mini-control { width: 36px; height: 36px; font-size: 15px; }
  .mini-control.play { width: 48px; height: 48px; color: #111315; background: rgba(250, 250, 247, .96); }
  .mini-close:hover,
  .mini-control:hover { transform: scale(1.05); border-color: rgba(var(--accent-rgb), .58); }
  .mini-close:hover { color: var(--accent); background: rgba(var(--accent-rgb), .16); }
  .mini-close:active,
  .mini-control:active { transform: scale(.94); }
  .mini-close:focus-visible,
  .mini-control:focus-visible { outline: 2px solid rgba(var(--accent-rgb), .72); outline-offset: 2px; }

  .mini-copy { align-self: end; min-width: 0; }
  .mini-scene { margin: 0 0 4px; color: rgba(var(--accent-rgb), .92); font-size: 10px; font-weight: 700; letter-spacing: .14em; text-transform: uppercase; }
  .mini-track { margin: 0; overflow: hidden; font-size: clamp(21px, 7vw, 30px); font-weight: 470; letter-spacing: -.045em; text-overflow: ellipsis; white-space: nowrap; }
  .mini-note { margin: 4px 0 0; overflow: hidden; color: rgba(255, 255, 255, .55); font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }

  .mini-visualizer { height: 28px; display: flex; align-items: center; gap: 3px; margin-right: auto; }
  .mini-visualizer i { width: 3px; min-height: 4px; border-radius: 999px; background: linear-gradient(to top, rgba(255, 255, 255, .52), var(--accent)); transition: height 80ms linear; }
  .mini-volume { min-width: 34px; color: rgba(255, 255, 255, .64); font-size: 11px; font-variant-numeric: tabular-nums; text-align: right; }
`;

function isSafariBrowser() {
  return /Safari/i.test(navigator.userAgent) && !/(Chrome|Chromium|CriOS|Edg|OPR)/i.test(navigator.userAgent);
}

export function createMiniPlayer({ getState, setAudioPlaying, previousTrack, nextTrack, onStateChange }) {
  let floatingWindow;
  let floatingDocument;
  let miniVideo;
  let attachedVideo;
  let mode = "";
  let automatic = false;
  let opening = false;
  let syncTimer;
  let metadataKey = "";

  const handleNativeEnter = () => setOpenState(true, "native", automatic);
  const handleNativeLeave = () => setOpenState(false, "", false);
  const handleWebkitMode = () => {
    const open = attachedVideo?.webkitPresentationMode === "picture-in-picture";
    setOpenState(open, open ? "native" : "", open ? automatic : false);
  };
  const handleNativePause = () => {
    if (mode === "native") setAudioPlaying(false);
  };
  const handleNativePlay = () => {
    if (mode === "native") setAudioPlaying(true);
  };

  function setOpenState(open, nextMode = "", wasAutomatic = false) {
    mode = open ? nextMode : "";
    automatic = open && wasAutomatic;
    onStateChange?.(open, mode);
  }

  function attachVideoListeners() {
    const video = getState().video;
    if (!video || video === attachedVideo) return;
    if (attachedVideo) {
      attachedVideo.removeEventListener("enterpictureinpicture", handleNativeEnter);
      attachedVideo.removeEventListener("leavepictureinpicture", handleNativeLeave);
      attachedVideo.removeEventListener("webkitpresentationmodechanged", handleWebkitMode);
      attachedVideo.removeEventListener("pause", handleNativePause);
      attachedVideo.removeEventListener("play", handleNativePlay);
    }
    attachedVideo = video;
    attachedVideo.addEventListener("enterpictureinpicture", handleNativeEnter);
    attachedVideo.addEventListener("leavepictureinpicture", handleNativeLeave);
    attachedVideo.addEventListener("webkitpresentationmodechanged", handleWebkitMode);
    attachedVideo.addEventListener("pause", handleNativePause);
    attachedVideo.addEventListener("play", handleNativePlay);
  }

  function updateMediaSession(state) {
    if (!("mediaSession" in navigator) || !("MediaMetadata" in window)) return;
    const nextKey = `${state.sceneTitle}|${state.trackTitle}|${state.trackNote}`;
    if (metadataKey === nextKey) return;
    metadataKey = nextKey;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: state.trackTitle,
      artist: `Atmosphere · ${state.sceneTitle}`,
      album: state.trackNote,
    });
  }

  function setMediaAction(action, handler) {
    try { navigator.mediaSession?.setActionHandler(action, handler); } catch (error) { /* Unsupported action. */ }
  }

  function buildThemedWindow(targetWindow, targetMode) {
    floatingWindow = targetWindow;
    floatingDocument = targetWindow.document;
    floatingDocument.head.innerHTML = `<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#0a0c0d"><title>Atmosphere Mini Player</title><style>${MINI_PLAYER_STYLES}</style>`;
    floatingDocument.body.innerHTML = `
      <main class="mini-player">
        <div class="mini-poster"></div>
        <video autoplay muted loop playsinline></video>
        <div class="mini-wash"></div>
        <section class="mini-glass" aria-label="Atmosphere mini player">
          <header class="mini-head">
            <span class="mini-brand">ATMO <i>—</i> SPHERE</span>
            <button class="mini-close" type="button" aria-label="Close mini player">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7.5 7.5 16.5 16.5M16.5 7.5 7.5 16.5" /></svg>
            </button>
          </header>
          <div class="mini-copy">
            <p class="mini-scene"></p>
            <h1 class="mini-track"></h1>
            <p class="mini-note"></p>
          </div>
          <footer class="mini-controls">
            <button class="mini-control previous" type="button" aria-label="Previous audio track">‹</button>
            <button class="mini-control play" type="button" aria-label="Play audio">▶</button>
            <button class="mini-control next" type="button" aria-label="Next audio track">›</button>
            <div class="mini-visualizer" aria-hidden="true">${Array.from({ length: 8 }, () => "<i></i>").join("")}</div>
            <span class="mini-volume"></span>
          </footer>
        </section>
      </main>`;

    miniVideo = floatingDocument.querySelector("video");
    floatingDocument.querySelector(".mini-close").addEventListener("click", close);
    floatingDocument.querySelector(".play").addEventListener("click", () => setAudioPlaying(!getState().isAudioPlaying));
    floatingDocument.querySelector(".previous").addEventListener("click", previousTrack);
    floatingDocument.querySelector(".next").addEventListener("click", nextTrack);
    targetWindow.addEventListener("pagehide", handleFloatingWindowClosed, { once: true });
    targetWindow.addEventListener("beforeunload", handleFloatingWindowClosed, { once: true });
    setOpenState(true, targetMode, automatic);
    clearInterval(syncTimer);
    syncTimer = setInterval(sync, 250);
    sync();
  }

  function handleFloatingWindowClosed() {
    clearInterval(syncTimer);
    floatingWindow = undefined;
    floatingDocument = undefined;
    miniVideo = undefined;
    if (mode === "document" || mode === "popup") setOpenState(false, "", false);
  }

  function syncVideo(state) {
    if (!miniVideo || !state.video) return;
    const source = state.video.currentSrc || state.video.src;
    if (source && miniVideo.src !== source) {
      miniVideo.src = source;
      miniVideo.poster = state.poster;
      miniVideo.addEventListener("loadedmetadata", () => {
        miniVideo.currentTime = state.video.currentTime || 0;
      }, { once: true });
    } else if (miniVideo.readyState >= 1 && Math.abs(miniVideo.currentTime - state.video.currentTime) > 1.8) {
      miniVideo.currentTime = state.video.currentTime || 0;
    }
    miniVideo.playbackRate = state.video.playbackRate || 1;
    if (state.isVideoPlaying) miniVideo.play().catch(() => {});
    else miniVideo.pause();
  }

  function sync(providedState) {
    const state = providedState || getState();
    attachVideoListeners();
    updateMediaSession(state);
    if (attachedVideo && "autoPictureInPicture" in attachedVideo) {
      attachedVideo.autoPictureInPicture = Boolean(state.isAudioPlaying);
    }
    if (!floatingDocument || floatingWindow?.closed) {
      if (floatingWindow?.closed) handleFloatingWindowClosed();
      return;
    }

    const root = floatingDocument.documentElement;
    root.style.setProperty("--accent", state.accent);
    root.style.setProperty("--accent-rgb", state.accentRgb);
    root.style.setProperty("--video-position", state.videoPosition);
    root.style.setProperty("--video-scale", state.videoScale);
    floatingDocument.querySelector(".mini-poster").style.backgroundImage = `url('${state.poster}')`;
    floatingDocument.querySelector(".mini-scene").textContent = `${state.category} · ${state.sceneTitle}`;
    floatingDocument.querySelector(".mini-track").textContent = state.trackTitle;
    floatingDocument.querySelector(".mini-note").textContent = state.trackNote;
    floatingDocument.querySelector(".mini-volume").textContent = `${Math.round(state.volume * 100)}%`;

    const playButton = floatingDocument.querySelector(".play");
    playButton.textContent = state.isAudioPlaying ? "Ⅱ" : "▶";
    playButton.setAttribute("aria-label", state.isAudioPlaying ? "Pause audio" : "Play audio");

    floatingDocument.querySelectorAll(".mini-visualizer i").forEach((bar, index) => {
      bar.style.height = `${Math.max(4, Math.min(28, state.visualLevels[index] || 4))}px`;
      bar.style.opacity = state.isAudioPlaying ? ".9" : ".4";
    });
    syncVideo(state);
  }

  async function openDocumentPip() {
    const targetWindow = await window.documentPictureInPicture.requestWindow({ width: 380, height: 240 });
    buildThemedWindow(targetWindow, "document");
  }

  async function openNativePip(video) {
    if (!video) return false;
    if (document.pictureInPictureElement === video || video.webkitPresentationMode === "picture-in-picture") {
      setOpenState(true, "native", automatic);
      return true;
    }
    if (typeof video.requestPictureInPicture === "function" && document.pictureInPictureEnabled !== false) {
      await video.requestPictureInPicture();
      setOpenState(true, "native", automatic);
      return true;
    }
    if (typeof video.webkitSupportsPresentationMode === "function" && video.webkitSupportsPresentationMode("picture-in-picture")) {
      video.webkitSetPresentationMode("picture-in-picture");
      setOpenState(true, "native", automatic);
      return true;
    }
    return false;
  }

  function openPopup() {
    const width = 380;
    const height = 240;
    const left = Math.max(0, (window.screen.availLeft || 0) + window.screen.availWidth - width - 24);
    const top = Math.max(0, (window.screen.availTop || 0) + window.screen.availHeight - height - 56);
    const popupUrl = new URL("/mini-player.html", window.location.href).href;
    const targetWindow = window.open(popupUrl, "atmosphere-mini-player", `popup=yes,width=${width},height=${height},left=${left},top=${top}`);
    if (!targetWindow) return false;

    const initialize = () => {
      if (targetWindow.closed) return;
      try {
        targetWindow.moveTo(left, top);
        targetWindow.resizeTo(width, height);
      } catch (error) { /* The browser may own popup placement. */ }
      buildThemedWindow(targetWindow, "popup");
      targetWindow.focus();
    };

    try {
      if (targetWindow.location.pathname === "/mini-player.html" && targetWindow.document.readyState === "complete") initialize();
      else targetWindow.addEventListener("load", initialize, { once: true });
    } catch (error) {
      targetWindow.addEventListener("load", initialize, { once: true });
    }
    return true;
  }

  async function open({ automatic: automaticRequest = false } = {}) {
    if (opening || isOpen()) return true;
    opening = true;
    automatic = automaticRequest;
    const video = getState().video;
    try {
      if ("documentPictureInPicture" in window && window.isSecureContext) {
        await openDocumentPip();
        return true;
      }

      if (automaticRequest || isSafariBrowser()) {
        try {
          if (await openNativePip(video)) return true;
        } catch (error) { /* Fall through to the next compatible option. */ }
      }

      if (!automaticRequest && openPopup()) return true;

      try { return await openNativePip(video); } catch (error) { return false; }
    } finally {
      opening = false;
    }
  }

  async function close() {
    clearInterval(syncTimer);
    if (mode === "document" || mode === "popup") {
      floatingWindow?.close();
      handleFloatingWindowClosed();
      return;
    }
    if (document.pictureInPictureElement) {
      try { await document.exitPictureInPicture(); } catch (error) { /* Already closed. */ }
    } else if (attachedVideo?.webkitPresentationMode === "picture-in-picture") {
      attachedVideo.webkitSetPresentationMode("inline");
    }
    setOpenState(false, "", false);
  }

  function isOpen() {
    return Boolean(
      (floatingWindow && !floatingWindow.closed) ||
      document.pictureInPictureElement ||
      attachedVideo?.webkitPresentationMode === "picture-in-picture"
    );
  }

  async function toggle() {
    if (isOpen()) {
      await close();
      return false;
    }
    return open({ automatic: false });
  }

  async function handleVisibilityChange() {
    const state = getState();
    if (document.hidden && state.isAudioPlaying && !isOpen()) {
      await open({ automatic: true });
    } else if (!document.hidden && automatic && isOpen()) {
      await close();
    }
  }

  function destroy() {
    document.removeEventListener("visibilitychange", handleVisibilityChange);
    close();
    if (attachedVideo) {
      attachedVideo.removeEventListener("enterpictureinpicture", handleNativeEnter);
      attachedVideo.removeEventListener("leavepictureinpicture", handleNativeLeave);
      attachedVideo.removeEventListener("webkitpresentationmodechanged", handleWebkitMode);
      attachedVideo.removeEventListener("pause", handleNativePause);
      attachedVideo.removeEventListener("play", handleNativePlay);
    }
    ["play", "pause", "previoustrack", "nexttrack", "enterpictureinpicture"].forEach((action) => setMediaAction(action, null));
  }

  document.addEventListener("visibilitychange", handleVisibilityChange);
  setMediaAction("play", () => setAudioPlaying(true));
  setMediaAction("pause", () => setAudioPlaying(false));
  setMediaAction("previoustrack", previousTrack);
  setMediaAction("nexttrack", nextTrack);
  setMediaAction("enterpictureinpicture", () => open({ automatic: true }));
  sync();

  return { open, close, toggle, sync, destroy, isOpen };
}

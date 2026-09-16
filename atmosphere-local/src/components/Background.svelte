<script>
  import { createEventDispatcher, onDestroy, onMount } from "svelte";

  export let background = "";
  export let adaptiveBackground = "";
  export let poster = "";
  export let paused = false;
  export let playbackRate = 1;
  export let start = 0;
  export let scale = 1.025;
  export let position = "50% 50%";
  export let viewKey = "";

  const dispatch = createEventDispatcher();
  let videoElement;
  let activeSource = "";
  let activeView = "";
  let useAdaptive = false;
  let forceAdaptive = false;
  let mediaReady = false;
  let loading = true;
  let failed = false;
  let connection;

  export function getVideoElement() {
    return videoElement;
  }

  export function setAutoPictureInPicture(enabled) {
    if (videoElement && "autoPictureInPicture" in videoElement) {
      videoElement.autoPictureInPicture = Boolean(enabled);
    }
  }

  function updateMediaPreference() {
    const constrainedNetwork = connection?.saveData || /(2g|3g)$/.test(connection?.effectiveType || "");
    useAdaptive = forceAdaptive || constrainedNetwork || window.matchMedia("(max-width: 720px)").matches;
  }

  function resolveVideoSource(source) {
    if (/^https?:\/\//i.test(source || "")) return source;
    return source ? `/assets/videos/${source}` : "";
  }

  onMount(() => {
    connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    updateMediaPreference();
    mediaReady = true;
    connection?.addEventListener?.("change", updateMediaPreference);
    window.addEventListener("resize", updateMediaPreference, { passive: true });
  });

  $: selectedBackground = mediaReady ? (useAdaptive && adaptiveBackground ? adaptiveBackground : background) : "";
  $: nextSource = resolveVideoSource(selectedBackground);
  $: if (videoElement && nextSource && nextSource !== activeSource) {
    activeSource = nextSource;
    activeView = "";
    loading = true;
    failed = false;
    videoElement.src = nextSource;
    videoElement.load();
  }

  $: if (videoElement) videoElement.playbackRate = playbackRate;

  $: if (videoElement && viewKey && activeView !== viewKey && videoElement.readyState >= 1) {
    applyView();
  }

  $: if (videoElement && activeSource) {
    if (paused) videoElement.pause();
    else videoElement.play().catch(() => {});
  }

  function handleLoadedMetadata() {
    videoElement.playbackRate = playbackRate;
    applyView();
    dispatch("durationchange", videoElement.duration || 0);
    if (!paused) videoElement.play().catch(() => {});
  }

  function applyView() {
    activeView = viewKey;
    if (Number.isFinite(videoElement.duration)) {
      videoElement.currentTime = Math.min(videoElement.duration * start, Math.max(0, videoElement.duration - 0.15));
    }
    videoElement.playbackRate = playbackRate;
  }

  function handleError() {
    if (!useAdaptive && adaptiveBackground) {
      forceAdaptive = true;
      updateMediaPreference();
      return;
    }
    loading = false;
    failed = true;
  }

  function handleTimeUpdate() {
    dispatch("timechange", videoElement.currentTime || 0);
  }

  onDestroy(() => {
    if (videoElement) videoElement.pause();
    connection?.removeEventListener?.("change", updateMediaPreference);
    window.removeEventListener("resize", updateMediaPreference);
  });
</script>

<div
  class:loading
  class:failed
  class="backdrop"
  aria-hidden="true"
  style={`--video-scale: ${scale}; --video-position: ${position}; --poster: url('/assets/videos/${poster}')`}
>
  <div class="poster"></div>
  <video
    bind:this={videoElement}
    autoplay
    muted
    loop
    playsinline
    preload="metadata"
    poster={poster ? `/assets/videos/${poster}` : undefined}
    on:loadedmetadata={handleLoadedMetadata}
    on:loadstart={() => (loading = true)}
    on:waiting={() => (loading = true)}
    on:playing={() => { loading = false; failed = false; }}
    on:error={handleError}
    on:timeupdate={handleTimeUpdate}
  ></video>
  <div class="wash"></div>
  <div class="grain"></div>
</div>

<style>
  .backdrop,
  .poster,
  .backdrop video,
  .wash,
  .grain {
    position: absolute;
    inset: 0;
  }

  .backdrop {
    position: fixed;
    z-index: 0;
    overflow: hidden;
    background: #101213;
  }

  video {
    width: 100%;
    height: 100%;
    object-fit: cover;
    object-position: var(--video-position);
    transform: scale(var(--video-scale));
    filter: saturate(0.78) contrast(1.08) brightness(0.75);
    opacity: 1;
    transition: opacity 520ms ease, transform 1.1s cubic-bezier(0.2, 0.75, 0.2, 1), object-position 1.1s cubic-bezier(0.2, 0.75, 0.2, 1);
  }

  .poster {
    background-color: #101213;
    background-image: var(--poster);
    background-position: var(--video-position);
    background-size: cover;
    transform: scale(var(--video-scale));
    filter: saturate(0.74) contrast(1.08) brightness(0.68);
  }

  .loading video,
  .failed video { opacity: 0; }

  .failed .poster {
    filter: saturate(0.56) contrast(1.04) brightness(0.54);
  }

  .wash {
    background:
      radial-gradient(circle at 68% 42%, transparent 0 22%, rgba(4, 7, 8, 0.17) 52%, rgba(2, 4, 5, 0.58) 100%),
      linear-gradient(90deg, rgba(2, 5, 6, 0.54) 0%, rgba(3, 5, 6, 0.12) 54%, rgba(2, 4, 5, 0.32) 100%),
      linear-gradient(180deg, rgba(3, 5, 6, 0.16) 0%, transparent 50%, rgba(2, 4, 5, 0.42) 100%);
  }

  .grain {
    opacity: 0.1;
    pointer-events: none;
    background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 180 180' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.82' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='.55'/%3E%3C/svg%3E");
    mix-blend-mode: soft-light;
  }

  @media (max-width: 600px) {
    .wash {
      background:
        linear-gradient(180deg, rgba(2, 4, 5, 0.12) 0%, rgba(2, 4, 5, 0.1) 34%, rgba(2, 4, 5, 0.78) 100%),
        radial-gradient(circle at 50% 35%, transparent 0 20%, rgba(2, 4, 5, 0.38) 90%);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    video { transform: none; }
  }
</style>

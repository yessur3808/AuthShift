<script>
  import { onDestroy, onMount } from "svelte";
  import Background from "./components/Background.svelte";
  import { createMiniPlayer } from "./miniPlayer";
  import { scenes } from "./sceneLibrary";

  let audioElement;
  let backgroundComponent;
  let activeIndex = 0;
  let selectedAudio = 0;
  let selectedVideo = 0;
  let audioStarted = false;
  let audioDirty = true;
  let isAudioPlaying = false;
  let isVideoPlaying = true;
  let volume = 0.52;
  let audioLoading = false;
  let audioError = "";
  let audioContext;
  let mediaSource;
  let gainNode;
  let analyserNode;
  let analyserData;
  let analyserFrame;
  let graphUnavailable = false;
  let visualLevels = [4, 6, 5, 7, 4, 6, 5, 4];
  let miniPlayerController;
  let miniPlayerOpen = false;
  let miniPlayerMode = "";
  let miniPlayerStatus = "";

  $: activeScene = scenes[activeIndex];
  $: activeTrack = activeScene.audioTracks[selectedAudio];
  $: activeVideo = activeScene.videoLoops[selectedVideo];
  $: miniPlayerSnapshot = {
    sceneTitle: activeScene.title,
    category: activeScene.category,
    accent: activeScene.accent,
    accentRgb: activeScene.accentRgb,
    trackTitle: activeTrack.title,
    trackNote: activeTrack.note,
    isAudioPlaying,
    isVideoPlaying,
    volume,
    visualLevels,
    videoPosition: activeVideo.position,
    videoScale: activeVideo.scale,
    poster: `/assets/videos/${activeVideo.poster}`,
    video: backgroundComponent?.getVideoElement(),
  };
  $: if (miniPlayerController && miniPlayerSnapshot) {
    backgroundComponent?.setAutoPictureInPicture(isAudioPlaying);
    miniPlayerController.sync(miniPlayerSnapshot);
  }

  function ensureAudioGraph() {
    if (gainNode || graphUnavailable || !audioElement) return;
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) {
      graphUnavailable = true;
      return;
    }

    try {
      audioContext = new AudioContext();
      mediaSource = audioContext.createMediaElementSource(audioElement);
      gainNode = audioContext.createGain();
      analyserNode = audioContext.createAnalyser();
      analyserNode.fftSize = 128;
      analyserNode.smoothingTimeConstant = 0.82;
      analyserData = new Uint8Array(analyserNode.frequencyBinCount);
      mediaSource.connect(gainNode);
      gainNode.connect(analyserNode);
      analyserNode.connect(audioContext.destination);
      gainNode.gain.value = volume;
      audioElement.volume = 1;
    } catch (error) {
      graphUnavailable = true;
      gainNode = undefined;
      analyserNode = undefined;
    }
  }

  async function resumeAudioGraph() {
    ensureAudioGraph();
    if (audioContext?.state === "suspended") {
      try { await audioContext.resume(); } catch (error) { /* Native media volume remains available. */ }
    }
  }

  function applyVolume() {
    if (!audioElement) return;
    if (gainNode && audioContext) {
      audioElement.volume = 1;
      gainNode.gain.cancelScheduledValues(audioContext.currentTime);
      gainNode.gain.setTargetAtTime(volume, audioContext.currentTime, 0.015);
    } else {
      audioElement.volume = volume;
    }
  }

  function drawVisualizer() {
    if (!analyserNode || !isAudioPlaying) return;
    analyserNode.getByteFrequencyData(analyserData);
    const bands = [1, 2, 4, 7, 11, 17, 25, 38];
    visualLevels = bands.map((start, index) => {
      const end = Math.min(bands[index + 1] || analyserData.length, analyserData.length);
      let total = 0;
      for (let bin = start; bin < end; bin += 1) total += analyserData[bin];
      const strength = total / Math.max(1, end - start) / 255;
      return Math.round(4 + Math.pow(strength, 0.62) * 28);
    });
    analyserFrame = requestAnimationFrame(drawVisualizer);
  }

  function startVisualizer() {
    cancelAnimationFrame(analyserFrame);
    if (analyserNode) analyserFrame = requestAnimationFrame(drawVisualizer);
  }

  function stopVisualizer() {
    cancelAnimationFrame(analyserFrame);
    visualLevels = [4, 5, 4, 6, 4, 5, 4, 4];
  }

  async function playTrack(track) {
    audioLoading = true;
    audioError = "";
    if (audioDirty || !audioElement.currentSrc.endsWith(track.src)) {
      audioElement.src = track.src;
      audioElement.load();
    }
    await resumeAudioGraph();
    applyVolume();
    try {
      await audioElement.play();
      audioStarted = true;
      audioDirty = false;
    } catch (error) {
      isAudioPlaying = false;
      audioLoading = false;
      audioError = "Audio could not start";
    }
  }

  async function toggleAudio() {
    if (isAudioPlaying) {
      audioElement.pause();
      return;
    }
    await playTrack(activeTrack);
  }

  async function setAudioPlaying(shouldPlay) {
    if (shouldPlay && !isAudioPlaying) await playTrack(activeTrack);
    else if (!shouldPlay && isAudioPlaying) audioElement.pause();
  }

  async function previousAudioTrack() {
    const nextIndex = (selectedAudio - 1 + activeScene.audioTracks.length) % activeScene.audioTracks.length;
    await selectTrack(nextIndex);
  }

  async function nextAudioTrack() {
    const nextIndex = (selectedAudio + 1) % activeScene.audioTracks.length;
    await selectTrack(nextIndex);
  }

  async function selectScene(index) {
    const continuePlaying = isAudioPlaying;
    activeIndex = index;
    selectedAudio = 0;
    selectedVideo = 0;
    isVideoPlaying = true;
    audioDirty = true;
    audioError = "";
    if (continuePlaying) {
      await playTrack(scenes[index].audioTracks[0]);
    } else if (audioStarted) {
      audioElement.pause();
    }
  }

  async function selectTrack(index) {
    const continuePlaying = isAudioPlaying;
    selectedAudio = index;
    audioDirty = true;
    audioError = "";
    if (continuePlaying) {
      await playTrack(activeScene.audioTracks[index]);
    }
  }

  function selectVideo(index) {
    selectedVideo = index;
    isVideoPlaying = true;
  }

  function updateVolume(event) {
    volume = Number(event.currentTarget.value);
    resumeAudioGraph();
    applyVolume();
  }

  function getMiniPlayerState() {
    return {
      ...miniPlayerSnapshot,
      video: backgroundComponent?.getVideoElement(),
    };
  }

  async function toggleMiniPlayer() {
    if (!miniPlayerController) return;
    const wasOpen = miniPlayerController.isOpen();
    miniPlayerStatus = wasOpen ? "Closing mini player" : "Opening mini player";
    const opened = await miniPlayerController.toggle();
    if (!wasOpen && !opened) {
      miniPlayerStatus = "Mini player was blocked. Allow popups or use your browser's video Picture-in-Picture control.";
    }
  }

  onMount(() => {
    miniPlayerController = createMiniPlayer({
      getState: getMiniPlayerState,
      setAudioPlaying,
      previousTrack: previousAudioTrack,
      nextTrack: nextAudioTrack,
      onStateChange: (open, mode) => {
        miniPlayerOpen = open;
        miniPlayerMode = mode;
        const label = mode === "document" ? "Picture-in-Picture" : mode === "native" ? "Video Picture-in-Picture" : "Mini player window";
        miniPlayerStatus = open ? `${label} opened` : "Mini player closed";
      },
    });
    miniPlayerController.sync(getMiniPlayerState());
  });

  onDestroy(() => {
    cancelAnimationFrame(analyserFrame);
    mediaSource?.disconnect();
    gainNode?.disconnect();
    analyserNode?.disconnect();
    audioContext?.close();
    miniPlayerController?.destroy();
  });
</script>

<svelte:head>
  <title>Atmosphere — Immersive ambient sounds & visual scenes</title>
  <meta
    name="description"
    content="Focus, relax, sleep, or reset with immersive ambient sounds, high-quality visual loops, and calming rain, ocean, fire, café, nature, and white-noise scenes."
  />
</svelte:head>

<div class="app-shell" style={`--accent: ${activeScene.accent}; --accent-rgb: ${activeScene.accentRgb}`}>
  <Background
    bind:this={backgroundComponent}
    background={activeVideo.background}
    adaptiveBackground={activeVideo.adaptiveBackground}
    poster={activeVideo.poster}
    paused={!isVideoPlaying}
    playbackRate={activeVideo.playbackRate}
    start={activeVideo.start}
    scale={activeVideo.scale}
    position={activeVideo.position}
    viewKey={activeVideo.id}
  />
  <audio
    bind:this={audioElement}
    preload="metadata"
    loop
    on:play={() => { isAudioPlaying = true; audioLoading = false; startVisualizer(); }}
    on:pause={() => { isAudioPlaying = false; stopVisualizer(); }}
    on:canplay={() => (audioLoading = false)}
    on:error={() => { audioLoading = false; audioError = "Audio unavailable"; }}
  ></audio>

  <header class="topbar">
    <a class="wordmark" href="/" aria-label="Atmosphere home">
      <span>ATMO</span><i></i><span>SPHERE</span>
    </a>
    <div class="topbar-actions">
      <a class="credits-link" href="/audio-credits.html" target="_blank" rel="noreferrer">Audio credits</a>
      <button
        class:pip-active={miniPlayerOpen}
        class="pip-toggle glass-button"
        type="button"
        aria-pressed={miniPlayerOpen}
        aria-label={miniPlayerOpen ? "Close mini player" : "Open mini player"}
        title={miniPlayerOpen ? "Close mini player" : "Keep Atmosphere visible while you use another tab or app"}
        on:click={toggleMiniPlayer}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <rect x="3.5" y="4.5" width="17" height="14" rx="2.5" />
          <rect class="pip-window-mark" x="12" y="11" width="6.5" height="5" rx="1" />
        </svg>
        <span>{miniPlayerOpen ? "Close mini" : "Mini player"}</span>
      </button>
      <button
        class="video-toggle glass-button"
        type="button"
        aria-label={isVideoPlaying ? "Pause background video" : "Play background video"}
        on:click={() => (isVideoPlaying = !isVideoPlaying)}
      >
        {#if isVideoPlaying}
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8.5 6.5v11M15.5 6.5v11" /></svg>
          <span>Pause motion</span>
        {:else}
          <svg class="play-mark" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 9 6-9 6V6Z" /></svg>
          <span>Play motion</span>
        {/if}
      </button>
    </div>
    <p class="sr-only" aria-live="polite">{miniPlayerStatus}</p>
  </header>

  <main>
    {#key activeScene.id}
      <section class="scene-hero">
        <div>
          <p class="eyebrow">{activeScene.category} · Scene {String(activeIndex + 1).padStart(2, "0")}</p>
          <h1>{activeScene.title}</h1>
        </div>
        <p>{activeScene.description}</p>
      </section>
    {/key}

    <div class="workspace">
      <section class="library-panel liquid-panel" aria-labelledby="atmosphere-heading">
        <div class="section-heading">
          <div>
            <p class="kicker">Library</p>
            <h2 id="atmosphere-heading">Choose an atmosphere</h2>
          </div>
          <span>{scenes.length} scenes</span>
        </div>

        <div class="scene-grid">
          {#each scenes as scene, index (scene.id)}
            <button
              type="button"
              class="scene-card"
              class:active={index === activeIndex}
              aria-current={index === activeIndex ? "true" : undefined}
              on:click={() => selectScene(index)}
            >
              <span class="scene-index">{String(index + 1).padStart(2, "0")}</span>
              <span class="scene-card-copy">
                <strong>{scene.title}</strong>
                <small>{scene.category}</small>
              </span>
              <span class="scene-state" aria-hidden="true"></span>
            </button>
          {/each}
        </div>
      </section>

      <section class="mixer-panel liquid-panel" aria-labelledby="mixer-heading">
        <div class="section-heading mixer-heading">
          <div>
            <p class="kicker">Sound</p>
            <h2 id="mixer-heading">{activeTrack.title}</h2>
          </div>
          <span>{audioError || (audioLoading ? "Loading" : isAudioPlaying ? "Playing" : audioStarted ? "Paused" : "Ready")}</span>
        </div>

        <div class="main-transport">
          <button
            class="audio-button"
            class:playing={isAudioPlaying}
            type="button"
            aria-label={isAudioPlaying ? "Pause audio" : "Play audio"}
            on:click={toggleAudio}
          >
            <span class="audio-button-core">
              {#if isAudioPlaying}
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8.5 6v12M15.5 6v12" /></svg>
              {:else}
                <svg class="play-mark" viewBox="0 0 24 24" aria-hidden="true"><path d="m8.5 5.5 11 6.5-11 6.5v-13Z" /></svg>
              {/if}
            </span>
          </button>

          <div class:playing={isAudioPlaying} class="equalizer" role="img" aria-label="Live audio level">
            {#each visualLevels as level}
              <i style={`height: ${level}px; opacity: ${isAudioPlaying ? 0.72 + level / 120 : 0.38}`}></i>
            {/each}
          </div>

          <div class="now-playing">
            <strong>{activeTrack.title}</strong>
            <span>{activeTrack.note} · recorded ambience</span>
          </div>
        </div>

        <label class="volume-row">
          <span>Volume</span>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={volume}
            aria-label="Audio volume"
            on:input={updateVolume}
          />
          <output>{Math.round(volume * 100)}</output>
        </label>

        <div class="option-section">
          <div class="option-heading">
            <h3>Audio layers</h3>
            <span>5 tracks</span>
          </div>
          {#key activeScene.id}
            <div class="track-grid option-grid-enter">
              {#each activeScene.audioTracks as track, index (track.id)}
                <button
                  type="button"
                  class="track-card"
                  class:active={selectedAudio === index}
                  aria-pressed={selectedAudio === index}
                  on:click={() => selectTrack(index)}
                >
                  <span class="track-number">0{index + 1}</span>
                  <span><strong>{track.title}</strong><small>{track.note}</small></span>
                </button>
              {/each}
            </div>
          {/key}
        </div>

        <div class="option-section video-section">
          <div class="option-heading">
            <h3>Video loops</h3>
            <span>4 views</span>
          </div>
          {#key activeScene.id}
            <div class="video-grid option-grid-enter">
              {#each activeScene.videoLoops as loop, index (loop.id)}
                <button
                  type="button"
                  class="video-card"
                  class:active={selectedVideo === index}
                  aria-pressed={selectedVideo === index}
                  on:click={() => selectVideo(index)}
                >
                  <span>0{index + 1}</span>
                  <strong>{loop.title}</strong>
                </button>
              {/each}
            </div>
          {/key}
        </div>
      </section>
    </div>
  </main>
</div>

<style>
  .app-shell {
    min-height: 100svh;
    position: relative;
    color: #f7f7f4;
    isolation: isolate;
    transition: --accent 480ms ease;
  }

  .topbar {
    position: fixed;
    z-index: 20;
    top: 0;
    left: 0;
    right: 0;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 22px clamp(18px, 3.5vw, 52px);
    pointer-events: none;
  }

  .topbar > * { pointer-events: auto; }

  .topbar-actions {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .credits-link {
    color: rgba(255, 255, 255, 0.62);
    font-size: 0.73rem;
    letter-spacing: 0.04em;
    text-decoration: none;
    transition: color 180ms ease;
  }

  .credits-link:hover { color: #fff; }

  .wordmark {
    display: inline-flex;
    align-items: center;
    gap: 9px;
    color: inherit;
    font-size: 0.72rem;
    font-weight: 680;
    letter-spacing: 0.19em;
    text-decoration: none;
  }

  .wordmark i {
    width: 22px;
    height: 1px;
    background: linear-gradient(90deg, currentColor, var(--accent));
    opacity: 0.62;
  }

  .glass-button {
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 11px 15px;
    border: 1px solid rgba(255, 255, 255, 0.18);
    border-radius: 999px;
    color: rgba(255, 255, 255, 0.76);
    background: rgba(24, 25, 27, 0.32);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.1), 0 8px 30px rgba(0, 0, 0, 0.14);
    backdrop-filter: blur(22px) saturate(155%);
    -webkit-backdrop-filter: blur(22px) saturate(155%);
    cursor: pointer;
    transition: transform 320ms cubic-bezier(0.2, 0.8, 0.2, 1), background 220ms ease, color 220ms ease;
  }

  .glass-button:hover { transform: translateY(-2px); color: #fff; background: rgba(255, 255, 255, 0.14); }
  .glass-button:active { transform: scale(0.96); }

  .video-toggle svg,
  .pip-toggle svg {
    width: 15px;
    height: 15px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.7;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .pip-toggle.pip-active {
    color: #fff;
    border-color: rgba(var(--accent-rgb), 0.64);
    background: rgba(var(--accent-rgb), 0.16);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.14), 0 8px 30px rgba(0, 0, 0, 0.18), 0 0 24px rgba(var(--accent-rgb), 0.12);
  }

  .pip-window-mark {
    fill: rgba(var(--accent-rgb), 0.52);
    stroke-width: 1.35;
  }

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }

  main {
    position: relative;
    z-index: 3;
    width: min(1500px, 100%);
    margin: 0 auto;
    padding: 104px clamp(16px, 3.5vw, 52px) 42px;
  }

  .scene-hero {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 40px;
    min-height: 170px;
    margin-bottom: 28px;
    animation: hero-in 580ms cubic-bezier(0.16, 1, 0.3, 1) both;
  }

  @keyframes hero-in {
    from { opacity: 0; transform: translateY(18px); filter: blur(8px); }
    to { opacity: 1; transform: translateY(0); filter: blur(0); }
  }

  .eyebrow,
  .kicker {
    margin: 0 0 9px;
    color: rgba(255, 255, 255, 0.58);
    font-size: 0.69rem;
    font-weight: 680;
    letter-spacing: 0.15em;
    text-transform: uppercase;
  }

  .kicker { color: rgba(var(--accent-rgb), 0.82); }

  h1 {
    position: relative;
    display: inline-block;
    margin: 0;
    font-size: clamp(4.4rem, 8vw, 8.7rem);
    font-weight: 390;
    line-height: 0.82;
    letter-spacing: -0.075em;
    text-shadow: 0 0 42px rgba(var(--accent-rgb), 0.12);
  }

  h1::after {
    content: "";
    position: absolute;
    inset: -0.04em -0.08em;
    pointer-events: none;
    opacity: 0.12;
    background: linear-gradient(112deg, transparent 18%, rgba(255, 255, 255, 0.72) 42%, rgba(var(--accent-rgb), 0.5) 49%, transparent 68%);
    mix-blend-mode: screen;
    filter: blur(7px);
    transform: skewX(-8deg);
  }

  .scene-hero > p {
    width: min(390px, 34vw);
    margin: 0 0 4px;
    color: rgba(255, 255, 255, 0.7);
    font-size: 0.96rem;
    line-height: 1.55;
  }

  .workspace {
    display: grid;
    grid-template-columns: minmax(540px, 1.25fr) minmax(390px, 0.8fr);
    align-items: start;
    gap: 18px;
  }

  .liquid-panel {
    position: relative;
    overflow: hidden;
    border: 1px solid rgba(255, 255, 255, 0.16);
    border-radius: 32px;
    background: linear-gradient(145deg, rgba(24, 27, 29, 0.78), rgba(11, 14, 16, 0.68));
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.1), 0 28px 90px rgba(0, 0, 0, 0.28), 0 0 70px rgba(var(--accent-rgb), 0.045);
    backdrop-filter: blur(28px) saturate(142%);
    -webkit-backdrop-filter: blur(28px) saturate(142%);
  }

  .liquid-panel::before {
    content: "";
    position: absolute;
    inset: 0;
    pointer-events: none;
    background: linear-gradient(115deg, rgba(255, 255, 255, 0.1), transparent 24% 72%, rgba(255, 255, 255, 0.035));
    mask-image: linear-gradient(#000, transparent 74%);
  }

  .library-panel,
  .mixer-panel { padding: clamp(20px, 2.2vw, 30px); }

  .section-heading,
  .option-heading {
    position: relative;
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 20px;
  }

  .section-heading { margin-bottom: 20px; }

  .section-heading h2,
  .option-heading h3 {
    margin: 0;
    font-weight: 480;
    letter-spacing: -0.035em;
  }

  .section-heading h2 { font-size: clamp(1.45rem, 2vw, 1.85rem); }
  .option-heading h3 { font-size: 0.86rem; letter-spacing: -0.01em; }

  .section-heading > span,
  .option-heading > span {
    color: rgba(255, 255, 255, 0.45);
    font-size: 0.72rem;
    white-space: nowrap;
  }

  .scene-grid {
    position: relative;
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 8px;
  }

  .scene-card,
  .track-card,
  .video-card {
    position: relative;
    overflow: hidden;
    border: 1px solid rgba(255, 255, 255, 0.08);
    color: rgba(255, 255, 255, 0.72);
    background: rgba(22, 25, 27, 0.74);
    cursor: pointer;
    text-align: left;
    transition: transform 420ms cubic-bezier(0.16, 1, 0.3, 1), color 220ms ease, background 280ms ease, border-color 280ms ease, box-shadow 280ms ease;
  }

  .scene-card::before,
  .track-card::before,
  .video-card::before {
    content: "";
    position: absolute;
    inset: 0;
    opacity: 0;
    background: radial-gradient(circle at 15% 0%, rgba(255, 255, 255, 0.2), transparent 52%);
    transition: opacity 280ms ease;
  }

  .scene-card:hover,
  .track-card:hover,
  .video-card:hover {
    transform: translateY(-3px);
    color: #fff;
    border-color: rgba(var(--accent-rgb), 0.42);
    background: rgba(37, 41, 44, 0.86);
  }

  .scene-card:hover::before,
  .track-card:hover::before,
  .video-card:hover::before { opacity: 1; }

  .scene-card:active,
  .track-card:active,
  .video-card:active { transform: scale(0.975); }

  .scene-card {
    min-height: 88px;
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: 12px;
    padding: 14px;
    border-radius: 19px;
  }

  .scene-card.active,
  .track-card.active,
  .video-card.active {
    color: #111315;
    border-color: rgba(var(--accent-rgb), 0.8);
    background: linear-gradient(145deg, rgba(248, 248, 244, 0.96), rgba(var(--accent-rgb), 0.82));
    box-shadow: 0 10px 28px rgba(0, 0, 0, 0.16), 0 0 30px rgba(var(--accent-rgb), 0.13), inset 0 1px 0 white;
  }

  .scene-index,
  .track-number,
  .video-card > span {
    color: rgba(255, 255, 255, 0.35);
    font-size: 0.65rem;
    font-variant-numeric: tabular-nums;
  }

  .active .scene-index,
  .active .track-number,
  .video-card.active > span { color: rgba(17, 19, 21, 0.42); }

  .scene-card-copy,
  .track-card > span:last-child { display: grid; gap: 4px; min-width: 0; }
  .scene-card strong,
  .track-card strong,
  .video-card strong { position: relative; font-size: 0.87rem; font-weight: 540; line-height: 1.18; }
  .scene-card small,
  .track-card small { position: relative; color: rgba(255, 255, 255, 0.4); font-size: 0.68rem; }
  .scene-card.active small,
  .track-card.active small { color: rgba(17, 19, 21, 0.54); }

  .scene-state {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.2);
    box-shadow: 0 0 0 0 rgba(17, 19, 21, 0);
  }

  .scene-card.active .scene-state {
    background: var(--accent);
    animation: active-pulse 2.2s ease-out infinite;
  }

  @keyframes active-pulse {
    0% { box-shadow: 0 0 0 0 rgba(17, 19, 21, 0.26); }
    70%, 100% { box-shadow: 0 0 0 8px rgba(17, 19, 21, 0); }
  }

  .mixer-panel { animation: panel-rise 650ms 90ms cubic-bezier(0.16, 1, 0.3, 1) both; }
  .library-panel { animation: panel-rise 650ms cubic-bezier(0.16, 1, 0.3, 1) both; }
  @keyframes panel-rise { from { opacity: 0; transform: translateY(22px); } to { opacity: 1; transform: none; } }

  .mixer-heading { margin-bottom: 14px; }

  .main-transport {
    position: relative;
    min-height: 132px;
    display: grid;
    grid-template-columns: auto 1fr;
    align-items: center;
    column-gap: 18px;
    padding: 10px 0 14px;
  }

  .audio-button {
    grid-row: 1 / 3;
    width: 96px;
    height: 96px;
    display: grid;
    place-items: center;
    padding: 0;
    border: 1px solid rgba(255, 255, 255, 0.6);
    border-radius: 50%;
    background: rgba(28, 31, 33, 0.82);
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.22), inset 0 1px 0 rgba(255, 255, 255, 0.58);
    backdrop-filter: blur(14px);
    cursor: pointer;
    transition: transform 420ms cubic-bezier(0.16, 1, 0.3, 1), background 260ms ease, box-shadow 260ms ease;
  }

  .audio-button:hover { transform: scale(1.045); background: rgba(43, 47, 50, 0.92); }
  .audio-button:active { transform: scale(0.94); }
  .audio-button.playing { box-shadow: 0 0 0 7px rgba(var(--accent-rgb), 0.1), 0 16px 44px rgba(0, 0, 0, 0.24), 0 0 34px rgba(var(--accent-rgb), 0.16); }

  .audio-button-core {
    width: 70px;
    height: 70px;
    display: grid;
    place-items: center;
    border-radius: 50%;
    color: #111315;
    background: rgba(250, 250, 247, 0.96);
    box-shadow: 0 5px 16px rgba(0, 0, 0, 0.18);
  }

  .audio-button svg {
    width: 24px;
    height: 24px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.8;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .play-mark { margin-left: 2px; }

  .equalizer {
    height: 38px;
    display: flex;
    align-items: center;
    gap: 4px;
    padding-top: 10px;
  }

  .equalizer i {
    width: 3px;
    height: 6px;
    border-radius: 999px;
    background: linear-gradient(to top, rgba(255, 255, 255, 0.5), var(--accent));
    transform-origin: center;
    transition: height 70ms linear, opacity 120ms ease, background 480ms ease;
  }

  .now-playing { display: grid; align-self: start; gap: 4px; }
  .now-playing strong { font-size: 0.9rem; font-weight: 560; }
  .now-playing span { color: rgba(255, 255, 255, 0.45); font-size: 0.69rem; }

  .volume-row {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) 28px;
    align-items: center;
    gap: 13px;
    padding: 12px 14px;
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 16px;
    color: rgba(255, 255, 255, 0.64);
    background: rgba(22, 25, 27, 0.78);
    font-size: 0.74rem;
  }

  .volume-row input {
    width: 100%;
    min-height: 28px;
    accent-color: var(--accent);
    cursor: pointer;
    touch-action: pan-y;
  }
  .volume-row output { color: rgba(255, 255, 255, 0.88); font-variant-numeric: tabular-nums; text-align: right; }

  .option-section { margin-top: 24px; }
  .option-heading { align-items: center; margin-bottom: 10px; padding: 0 2px; }
  .track-grid,
  .video-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 7px; }

  .option-grid-enter { animation: options-in 480ms cubic-bezier(0.16, 1, 0.3, 1) both; }
  @keyframes options-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }

  .track-card {
    min-height: 62px;
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    align-items: center;
    gap: 10px;
    padding: 11px;
    border-radius: 16px;
  }

  .track-card:last-child:nth-child(odd) { grid-column: 1 / -1; }

  .video-section { padding-top: 21px; border-top: 1px solid rgba(255, 255, 255, 0.1); }

  .video-card {
    min-height: 58px;
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    align-items: center;
    gap: 10px;
    padding: 11px;
    border-radius: 15px;
  }

  .video-card strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 0.76rem; }

  @media (max-width: 1120px) {
    .workspace { grid-template-columns: 1fr; }
    .mixer-panel { order: -1; }
    .scene-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  }

  @media (max-width: 760px) {
    .topbar { padding: 18px 16px; }
    .credits-link { display: none; }
    .video-toggle span,
    .pip-toggle span { display: none; }
    .video-toggle,
    .pip-toggle { width: 42px; height: 42px; justify-content: center; padding: 0; }
    main { padding: 88px 12px 28px; }
    .scene-hero { min-height: 140px; display: block; margin: 0 8px 24px; }
    h1 { font-size: clamp(4rem, 21vw, 6.3rem); }
    .scene-hero > p { width: min(100%, 420px); margin-top: 22px; font-size: 0.9rem; }
    .liquid-panel { border-radius: 26px; }
    .library-panel, .mixer-panel { padding: 18px; }
    .mixer-panel { display: block; }
    .library-panel { order: -2; }
    .mixer-panel { order: -1; }
    .scene-grid {
      grid-template-columns: none;
      grid-template-rows: repeat(2, 76px);
      grid-auto-flow: column;
      grid-auto-columns: minmax(150px, 44vw);
      overflow-x: auto;
      padding: 2px 1px 8px;
      scroll-snap-type: x proximity;
      scrollbar-width: none;
    }
    .scene-grid::-webkit-scrollbar { display: none; }
    .track-grid, .video-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .scene-card { min-height: 78px; padding: 11px; gap: 9px; }
    .scene-card { min-height: 0; scroll-snap-align: start; }
    .scene-card small { display: none; }
    .scene-card strong { font-size: 0.8rem; }
    .audio-button { width: 88px; height: 88px; }
    .audio-button-core { width: 64px; height: 64px; }
    .track-card:last-child:nth-child(odd) { grid-column: auto; }
  }

  @media (max-width: 420px) {
    .scene-hero > p { display: none; }
    .scene-hero { min-height: 106px; }
    .scene-grid { gap: 6px; }
    .track-grid { grid-template-columns: 1fr; }
    .track-card:last-child:nth-child(odd) { grid-column: auto; }
    .video-card strong { font-size: 0.72rem; }
  }

  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after { animation-duration: 0.01ms !important; animation-iteration-count: 1 !important; transition-duration: 0.01ms !important; }
  }
</style>

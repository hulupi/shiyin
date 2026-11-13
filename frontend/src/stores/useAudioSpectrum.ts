import { onMounted, onUnmounted, ref, watch, type Ref } from "vue";

interface SpectrumSurface {
  painter: CanvasRenderingContext2D;
  width: number;
  height: number;
  ratio: number;
  levels: Float32Array;
  glow: CanvasGradient[];
}

/** One audio graph per media element. The analyser is a silent parallel branch. */
export function useAudioSpectrum(
  audio: Ref<HTMLAudioElement | undefined>,
  playing: Ref<boolean>,
) {
  const spectrumCanvas = ref<HTMLCanvasElement>();
  const lyricSpectrumCanvas = ref<HTMLCanvasElement>();
  let context: AudioContext | undefined;
  let source: MediaElementAudioSourceNode | undefined;
  let analyser: AnalyserNode | undefined;
  let samples = new Uint8Array(0);
  let frame = 0;
  let observer: ResizeObserver | undefined;

  const surfaces = new Map<HTMLCanvasElement, SpectrumSurface>();
  let lastFrame = 0;
  let reducedMotion: MediaQueryList | undefined;

  function clear() {
    for (const surface of surfaces.values()) {
      surface.painter.clearRect(0, 0, surface.width, surface.height);
      surface.levels.fill(0);
    }
  }

  function resize() {
    const canvases = [spectrumCanvas.value, lyricSpectrumCanvas.value];
    for (const canvas of surfaces.keys()) {
      if (!canvases.includes(canvas)) surfaces.delete(canvas);
    }
    for (const canvas of canvases) {
      if (!canvas) continue;
      const { clientWidth: width, clientHeight: height } = canvas;
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const old = surfaces.get(canvas);
      if (old?.width === width && old.height === height && old.ratio === ratio) continue;
      if (!width || !height) {
        surfaces.delete(canvas);
        continue;
      }
      const painter = canvas.getContext("2d");
      if (!painter) continue;
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      painter.setTransform(ratio, 0, 0, ratio, 0, 0);

      const count = Math.max(1, Math.min(96, Math.floor(width / 5)));
      const glow: CanvasGradient[] = [];
      for (let i = 0; i < count; i++) {
        const hue = 152 + 124 * i / Math.max(1, count - 1);
        const color = `hsl(${hue} 90% 75%)`;
        const gradient = painter.createLinearGradient(0, height, 0, 0);
        gradient.addColorStop(0, `hsl(${hue} 66% 34% / 0.52)`);
        gradient.addColorStop(0.74, color);
        gradient.addColorStop(1, color);
        glow.push(gradient);
      }
      surfaces.set(canvas, {
        painter, width, height, ratio, glow,
        levels: new Float32Array(count),
      });
    }
  }

  function stop() {
    cancelAnimationFrame(frame);
    frame = 0;
    lastFrame = 0;
  }

  function paint(surface: SpectrumSurface, delta: number, maxBin: number, lyrics: boolean) {
    const { painter, width, height, levels, glow } = surface;
    const animated = !reducedMotion?.matches;
    if (animated) {
      // Fade previous pixels against transparency so the player background stays visible.
      painter.globalCompositeOperation = "destination-out";
      painter.fillStyle = `rgb(0 0 0 / ${1 - Math.exp(-delta / 48)})`;
      painter.fillRect(0, 0, width, height);
      painter.globalCompositeOperation = "source-over";
    } else {
      painter.clearRect(0, 0, width, height);
    }

    const step = width / levels.length;
    const barWidth = Math.max(1, step - Math.min(2, step / 3));
    const ceiling = height * (lyrics ? 0.73 : 0.63);
    for (let i = 0; i < levels.length; i++) {
      const fraction = i / levels.length;
      // Give bass and midrange more columns while still sampling up to 16 kHz.
      const start = Math.floor(fraction ** 2 * maxBin);
      const end = Math.max(start + 1, Math.floor(((i + 1) / levels.length) ** 2 * maxBin));
      let peak = 0;
      let sum = 0;
      for (let bin = start; bin < end; bin++) {
        const sample = samples[bin] ?? 0;
        peak = Math.max(peak, sample);
        sum += sample;
      }
      const target = Math.min(1, (peak * 0.55 + sum / (end - start) * 0.45) * (1 + fraction * 0.28) / 255);
      const response = target > levels[i] ? 42 : 115;
      levels[i] += (target - levels[i]) * (1 - Math.exp(-delta / response));
      const barHeight = levels[i] * ceiling;
      if (barHeight < 0.6) continue;

      const x = i * step + (step - barWidth) / 2;
      const y = height - barHeight;
      const radius = Math.min(barWidth / 2, barHeight / 2);
      painter.fillStyle = glow[i];
      if (animated && levels[i] > 0.52) {
        painter.globalAlpha = 0.16;
        const spread = Math.min(1, (step - barWidth) * 0.45);
        const glowRadius = Math.min(radius + spread, (barHeight + 1) / 2);
        painter.beginPath();
        painter.roundRect(x - spread, y - 1, barWidth + spread * 2, barHeight + 1, [glowRadius, glowRadius, 0, 0]);
        painter.fill();
        painter.globalAlpha = 1;
      }
      painter.beginPath();
      painter.roundRect(x, y, barWidth, barHeight, [radius, radius, 0, 0]);
      painter.fill();
    }

  }

  function draw(time: number) {
    frame = 0;
    if (!playing.value || document.hidden || !analyser || !context) return;
    frame = requestAnimationFrame(draw);
    if (!surfaces.size) return;
    const delta = lastFrame ? Math.min(50, time - lastFrame) : 1000 / 60;
    lastFrame = time;
    analyser.getByteFrequencyData(samples);
    const maxBin = Math.max(1, Math.min(
      samples.length,
      Math.floor(16000 / (context.sampleRate / analyser.fftSize)),
    ));
    for (const [canvas, surface] of surfaces) {
      paint(surface, delta, maxBin, canvas === lyricSpectrumCanvas.value);
    }
  }

  function start() {
    if (!frame && analyser && playing.value && !document.hidden)
      frame = requestAnimationFrame(draw);
  }

  /** Invoke directly from a user playback action so browsers can resume audio. */
  function prepareSpectrum(): Promise<void> {
    if (!audio.value || !window.AudioContext) {
      return Promise.resolve();
    }
    if (!context) {
      try {
        context = new AudioContext();
        source = context.createMediaElementSource(audio.value);
        // Keep the audible route independent of visualisation setup/rendering.
        source.connect(context.destination);
      } catch {
        void context?.close().catch(() => {});
        context = undefined;
        return Promise.resolve();
      }
      try {
        analyser = context.createAnalyser();
        analyser.fftSize = 2048;
        analyser.smoothingTimeConstant = 0.85;
        analyser.minDecibels = -90;
        analyser.maxDecibels = -20;
        samples = new Uint8Array(analyser.frequencyBinCount);
        source!.connect(analyser);
      } catch {
        analyser = undefined;
      }
    }
    return context.resume().then(start, () => {});
  }

  function release() {
    stop();
    source?.disconnect();
    analyser?.disconnect();
    void context?.close().catch(() => {});
    context = undefined;
    source = undefined;
    analyser = undefined;
    clear();
  }

  watch(audio, (element, previous) => {
    if (previous && element !== previous) release();
  });
  watch(
    [spectrumCanvas, lyricSpectrumCanvas],
    () => {
      observer?.disconnect();
      observer = new ResizeObserver(resize);
      for (const canvas of [spectrumCanvas.value, lyricSpectrumCanvas.value]) {
        if (canvas) observer.observe(canvas);
      }
      resize();
    },
    { flush: "post" },
  );
  watch(playing, (value) => {
    if (value) start();
    else {
      stop();
      clear();
    }
  });
  function visibilityChanged() {
    if (document.hidden) stop();
    else if (playing.value) void prepareSpectrum();
  }
  onMounted(() => {
    reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    document.addEventListener("visibilitychange", visibilityChanged);
  });
  onUnmounted(() => {
    observer?.disconnect();
    document.removeEventListener("visibilitychange", visibilityChanged);
    release();
  });
  return { spectrumCanvas, lyricSpectrumCanvas, prepareSpectrum };
}

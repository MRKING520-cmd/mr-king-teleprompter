(() => {
  "use strict";

  const STORAGE_KEY = "teleprompter-state-v1";
  const DEFAULT_FORMAT = {
    fontFamily: "system", fontSize: 64, bold: false, underline: false,
    color: "#f7f8f2", lineHeight: 1.58, letterSpacing: 0, align: "left"
  };
  const DEFAULT_THEME_COLORS = { dark: "#f7f8f2", light: "#171a17" };
  const DEFAULT_STATE = {
    text: "", speed: 35, position: 0, format: DEFAULT_FORMAT, markers: [],
    theme: "dark", themeColors: DEFAULT_THEME_COLORS, brandTitle: "金先生的提词板"
  };
  const $ = (selector) => document.querySelector(selector);

  const editorView = $("#editorView");
  const playerView = $("#playerView");
  const scriptInput = $("#scriptInput");
  const scriptDisplay = $("#scriptDisplay");
  const scrollViewport = $("#scrollViewport");
  const startButton = $("#startButton");
  const playPauseButton = $("#playPauseButton");
  const playPauseLabel = $("#playPauseLabel");
  const playIcon = $(".play-icon");
  const pauseIcon = $(".pause-icon");
  const backButton = $("#backButton");
  const speedSlider = $("#speedSlider");
  const speedOutput = $("#speedOutput");
  const progressFill = $("#progressFill");
  const wordCount = $("#wordCount");
  const saveStatus = $("#saveStatus");
  const toast = $("#toast");
  const fontFamily = $("#fontFamily");
  const fontSize = $("#fontSize");
  const boldButton = $("#boldButton");
  const underlineButton = $("#underlineButton");
  const textColor = $("#textColor");
  const lineHeight = $("#lineHeight");
  const letterSpacing = $("#letterSpacing");
  const alignButtons = [...document.querySelectorAll(".align-button")];
  const markerButton = $("#markerButton");
  const markerCount = $("#markerCount");
  const editorMirror = $("#editorMirror");
  const editorMarkerLayer = $("#editorMarkerLayer");
  const themeToggle = $("#themeToggle");
  const sunIcon = $(".sun-icon");
  const moonIcon = $(".moon-icon");
  const brandTitle = $("#brandTitle");
  const loveButton = $("#loveButton");
  const themeColorMeta = $("#themeColorMeta");

  let state = loadState();
  let playing = false;
  let inPlayer = false;
  let reachedEnd = false;
  let frameId = null;
  let lastFrameTime = 0;
  let saveTimer = null;
  let toastTimer = null;
  let loveClickCount = 0;

  hydrate();

  function loadState() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      const theme = saved?.theme === "light" ? "light" : "dark";
      const savedFormat = { ...DEFAULT_FORMAT, ...(saved?.format || {}) };
      const themeColors = {
        dark: saved?.themeColors?.dark || savedFormat.color || DEFAULT_THEME_COLORS.dark,
        light: saved?.themeColors?.light || DEFAULT_THEME_COLORS.light
      };
      return {
        ...DEFAULT_STATE,
        ...saved,
        theme,
        themeColors,
        format: { ...savedFormat, color: themeColors[theme] },
        markers: normalizeMarkers(saved?.markers)
      };
    } catch (_) {
      return {
        ...DEFAULT_STATE,
        format: { ...DEFAULT_FORMAT },
        themeColors: { ...DEFAULT_THEME_COLORS },
        markers: []
      };
    }
  }

  function hydrate() {
    applyTheme();
    brandTitle.value = state.brandTitle || DEFAULT_STATE.brandTitle;
    scriptInput.value = state.text;
    speedSlider.value = clamp(Number(state.speed) || DEFAULT_STATE.speed, 0, 100);
    updateSpeedOutput();
    updateWordCount();
    updateMarkerCount();
    hydrateFormat();
    renderEditorMarkers();
  }

  function scheduleSave() {
    saveStatus.textContent = "正在保存…";
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveState, 180);
  }

  function saveState() {
    state.text = scriptInput.value;
    state.brandTitle = brandTitle.value.trim() || DEFAULT_STATE.brandTitle;
    state.speed = Number(speedSlider.value);
    state.format = getFormat();
    state.themeColors[state.theme] = state.format.color;
    state.markers = normalizeMarkers(state.markers);
    if (inPlayer) state.position = scrollViewport.scrollTop;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      saveStatus.textContent = "已自动保存";
    } catch (_) {
      saveStatus.textContent = "浏览器未允许保存";
    }
  }

  function applyTheme() {
    document.documentElement.dataset.theme = state.theme;
    const isLight = state.theme === "light";
    themeColorMeta.content = isLight ? "#f4f6f1" : "#070908";
    sunIcon.classList.toggle("is-hidden", isLight);
    moonIcon.classList.toggle("is-hidden", !isLight);
    const label = isLight ? "切换到暗色模式" : "切换到亮色模式";
    themeToggle.setAttribute("aria-label", label);
    themeToggle.title = label;
  }

  function toggleTheme() {
    state.themeColors[state.theme] = textColor.value;
    state.theme = state.theme === "dark" ? "light" : "dark";
    const nextColor = state.themeColors[state.theme] || DEFAULT_THEME_COLORS[state.theme];
    state.format.color = nextColor;
    textColor.value = nextColor;
    applyTheme();
    applyFormat();
    scheduleSave();
  }

  function normalizeMarkers(markers) {
    if (!Array.isArray(markers)) return [];
    return [...new Set(markers.map(Number).filter((value) => Number.isInteger(value) && value >= 0))].sort((a, b) => a - b);
  }

  function paragraphIndexAtCaret() {
    return scriptInput.value.slice(0, scriptInput.selectionStart).split("\n").length - 1;
  }

  function paragraphStart(index) {
    const lines = scriptInput.value.split("\n");
    let position = 0;
    for (let i = 0; i < index; i += 1) position += lines[i].length + 1;
    return position;
  }

  function updateMarkerCount() {
    markerCount.textContent = String(state.markers.length);
    markerButton.classList.toggle("has-markers", state.markers.length > 0);
  }

  function renderEditorMarkers() {
    editorMirror.replaceChildren();
    editorMarkerLayer.replaceChildren();
    const lines = scriptInput.value.split("\n");
    lines.forEach((line, index) => {
      const paragraph = document.createElement("div");
      paragraph.className = "editor-mirror-paragraph";
      paragraph.dataset.paragraph = String(index);
      if (line) paragraph.textContent = line;
      else paragraph.appendChild(document.createElement("br"));
      editorMirror.appendChild(paragraph);
    });
    state.markers.forEach((paragraphIndex) => {
      const dot = document.createElement("span");
      dot.className = "editor-marker-dot";
      dot.dataset.paragraph = String(paragraphIndex);
      editorMarkerLayer.appendChild(dot);
    });
    requestAnimationFrame(positionEditorMarkers);
  }

  function positionEditorMarkers() {
    const editorHeight = scriptInput.clientHeight;
    const lineHeightPixels = parseFloat(getComputedStyle(scriptInput).lineHeight) || 40;
    editorMarkerLayer.querySelectorAll(".editor-marker-dot").forEach((dot) => {
      const paragraph = editorMirror.querySelector(`[data-paragraph="${dot.dataset.paragraph}"]`);
      if (!paragraph) {
        dot.style.opacity = "0";
        return;
      }
      const top = paragraph.offsetTop - scriptInput.scrollTop + lineHeightPixels * 0.5 - 3;
      dot.style.top = `${top}px`;
      dot.style.opacity = top > 8 && top < editorHeight - 8 ? "1" : "0";
    });
  }

  function toggleMarker() {
    if (!scriptInput.value.trim()) {
      showToast("请先输入提词内容");
      scriptInput.focus();
      return;
    }
    const paragraph = paragraphIndexAtCaret();
    const existing = state.markers.indexOf(paragraph);
    if (existing >= 0) {
      state.markers.splice(existing, 1);
      showToast(`已取消第 ${paragraph + 1} 段标点`);
    } else {
      state.markers.push(paragraph);
      state.markers = normalizeMarkers(state.markers);
      showToast(`已标记第 ${paragraph + 1} 段`);
    }
    updateMarkerCount();
    renderEditorMarkers();
    scheduleSave();
    scriptInput.focus();
  }

  function renderScript() {
    scriptDisplay.replaceChildren();
    scriptInput.value.split("\n").forEach((line, index) => {
      const paragraph = document.createElement("div");
      paragraph.className = "script-paragraph";
      paragraph.dataset.paragraph = String(index);
      if (state.markers.includes(index)) paragraph.classList.add("is-marker");
      if (line) paragraph.textContent = line;
      else paragraph.appendChild(document.createElement("br"));
      scriptDisplay.appendChild(paragraph);
    });
  }

  function currentPlayerParagraph() {
    const paragraphs = [...scriptDisplay.querySelectorAll(".script-paragraph")];
    const readingLine = scrollViewport.scrollTop + scrollViewport.clientHeight * 0.48;
    let current = 0;
    for (const paragraph of paragraphs) {
      if (paragraph.offsetTop <= readingLine + 1) current = Number(paragraph.dataset.paragraph);
      else break;
    }
    return current;
  }

  function navigationBounds() {
    const lines = scriptInput.value.split("\n");
    const first = lines.findIndex((line) => line.trim().length > 0);
    let last = -1;
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      if (lines[index].trim().length > 0) {
        last = index;
        break;
      }
    }
    return { first, last };
  }

  function navigationPoints() {
    const { first, last } = navigationBounds();
    if (first < 0 || last < 0) return [];
    return [...new Set([first, ...state.markers.filter((marker) => marker >= first && marker <= last), last])].sort((a, b) => a - b);
  }

  function jumpEditorToParagraph(paragraphIndex) {
    const paragraph = editorMirror.querySelector(`[data-paragraph="${paragraphIndex}"]`);
    const position = paragraphStart(paragraphIndex);
    const originalScrollTop = scriptInput.scrollTop;
    const lineHeightPixels = parseFloat(getComputedStyle(scriptInput).lineHeight) || 40;
    const targetCenter = paragraph ? paragraph.offsetTop + lineHeightPixels * 0.5 : 0;
    const edgeSpacing = Math.max(16, lineHeightPixels * 0.25);
    const targetIsVisible = Boolean(paragraph)
      && targetCenter - lineHeightPixels * 0.5 >= originalScrollTop + edgeSpacing
      && targetCenter + lineHeightPixels * 0.5 <= originalScrollTop + scriptInput.clientHeight - edgeSpacing;

    scriptInput.focus();
    scriptInput.setSelectionRange(position, position);

    requestAnimationFrame(() => {
      if (targetIsVisible) {
        scriptInput.scrollTop = originalScrollTop;
      } else if (paragraph) {
        const maxEditorScroll = Math.max(0, scriptInput.scrollHeight - scriptInput.clientHeight);
        scriptInput.scrollTop = clamp(targetCenter - scriptInput.clientHeight * 0.5, 0, maxEditorScroll);
      }
      positionEditorMarkers();
    });
  }

  function jumpToNavigationPoint(direction) {
    const points = navigationPoints();
    if (!points.length) {
      showToast("请先输入提词内容");
      return;
    }
    const current = inPlayer ? currentPlayerParagraph() : paragraphIndexAtCaret();
    const first = points[0];
    const last = points[points.length - 1];
    let target;
    if (!state.markers.length) {
      target = direction > 0 ? last : first;
      if (current === target) target = undefined;
    } else {
      target = direction > 0
        ? points.find((point) => point > current)
        : [...points].reverse().find((point) => point < current);
    }
    if (target === undefined) {
      showToast(direction > 0 ? "已经到达文本末尾" : "已经到达文本开头");
      return;
    }
    if (inPlayer) {
      const paragraph = scriptDisplay.querySelector(`[data-paragraph="${target}"]`);
      if (!paragraph) return;
      scrollViewport.scrollTop = clamp(paragraph.offsetTop - scrollViewport.clientHeight * 0.48, 0, maxScroll());
      reachedEnd = false;
      updateProgress();
      scheduleSave();
    } else {
      jumpEditorToParagraph(target);
    }
    if (target === first) showToast("已跳转到文本开头");
    else if (target === last) showToast("已跳转到文本末尾");
    else showToast(`已跳转到标点 ${state.markers.indexOf(target) + 1}/${state.markers.length}`);
  }

  function hydrateFormat() {
    const format = state.format || DEFAULT_FORMAT;
    fontFamily.value = format.fontFamily;
    fontSize.value = format.fontSize;
    textColor.value = format.color;
    lineHeight.value = String(format.lineHeight);
    letterSpacing.value = String(format.letterSpacing);
    boldButton.classList.toggle("is-active", format.bold);
    boldButton.setAttribute("aria-pressed", String(format.bold));
    underlineButton.classList.toggle("is-active", format.underline);
    underlineButton.setAttribute("aria-pressed", String(format.underline));
    alignButtons.forEach((button) => {
      const active = button.dataset.align === format.align;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    });
    applyFormat();
  }

  function getFormat() {
    return {
      fontFamily: fontFamily.value,
      fontSize: clamp(Number(fontSize.value) || 64, 16, 240),
      bold: boldButton.classList.contains("is-active"),
      underline: underlineButton.classList.contains("is-active"),
      color: textColor.value,
      lineHeight: Number(lineHeight.value),
      letterSpacing: Number(letterSpacing.value),
      align: alignButtons.find((button) => button.classList.contains("is-active"))?.dataset.align || "left"
    };
  }

  function applyFormat() {
    const format = getFormat();
    const families = {
      system: 'Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',
      sans: '"PingFang SC", "Microsoft YaHei", "Heiti SC", sans-serif',
      serif: '"Songti SC", SimSun, serif',
      kai: 'Kaiti SC, KaiTi, STKaiti, serif',
      mono: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'
    };
    [scriptInput, scriptDisplay, editorMirror].forEach((element) => {
      element.style.fontFamily = families[format.fontFamily];
      element.style.fontWeight = format.bold ? "800" : "500";
      element.style.textDecoration = format.underline ? "underline" : "none";
      element.style.color = format.color;
      element.style.lineHeight = String(format.lineHeight);
      element.style.letterSpacing = `${format.letterSpacing}em`;
      element.style.textAlign = format.align;
    });
    scriptDisplay.style.fontSize = `${format.fontSize}px`;
    scriptInput.style.fontSize = `${format.fontSize}px`;
    editorMirror.style.fontSize = `${format.fontSize}px`;
    requestAnimationFrame(positionEditorMarkers);
  }

  function formatChanged() {
    applyFormat();
    scheduleSave();
  }

  function toggleFormatButton(button) {
    const active = !button.classList.contains("is-active");
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
    formatChanged();
  }

  function updateWordCount() {
    const count = Array.from(scriptInput.value.trim()).length;
    wordCount.textContent = `${count} 字`;
  }

  function updateSpeedOutput() {
    const value = Number(speedSlider.value);
    speedOutput.value = value === 0 ? "暂停" : String(value);
    speedOutput.textContent = speedOutput.value;
  }

  function showToast(message) {
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("show"), 2200);
  }

  function releaseHearts() {
    loveClickCount += 1;
    const rect = loveButton.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    for (let index = 0; index < 5; index += 1) {
      const heart = document.createElement("span");
      heart.className = "heart-burst";
      heart.textContent = "❤️";
      heart.style.left = `${centerX + (Math.random() - 0.5) * 18}px`;
      heart.style.top = `${centerY + (Math.random() - 0.5) * 10}px`;
      heart.style.setProperty("--heart-drift", `${Math.round((Math.random() - 0.5) * 76)}px`);
      heart.style.setProperty("--heart-delay", `${index * 55}ms`);
      heart.style.setProperty("--heart-size", `${14 + Math.round(Math.random() * 9)}px`);
      document.body.appendChild(heart);
      heart.addEventListener("animationend", () => heart.remove(), { once: true });
    }
    if (loveClickCount > 52) showToast("开发者联系方式:1314520");
  }

  async function enterPlayer() {
    const text = scriptInput.value.trim();
    if (!text) {
      showToast("请先粘贴需要播放的文字");
      scriptInput.focus();
      return;
    }

    inPlayer = true;
    reachedEnd = false;
    renderScript();
    editorView.classList.add("is-hidden");
    playerView.classList.remove("is-hidden");
    playerView.setAttribute("aria-hidden", "false");

    requestAnimationFrame(() => {
      const max = maxScroll();
      scrollViewport.scrollTop = clamp(Number(state.position) || 0, 0, max);
      reachedEnd = max > 0 && scrollViewport.scrollTop >= max - 1;
      setPlaying(true);
      updateProgress();
    });

    try {
      if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
        await document.documentElement.requestFullscreen();
      }
    } catch (_) {
      showToast("浏览器未进入全屏，仍可正常播放");
    }
  }

  async function leavePlayer() {
    if (!inPlayer) return;
    setPlaying(false);
    saveState();
    inPlayer = false;
    playerView.classList.add("is-hidden");
    playerView.setAttribute("aria-hidden", "true");
    editorView.classList.remove("is-hidden");
    if (document.fullscreenElement) {
      try { await document.exitFullscreen(); } catch (_) { /* no-op */ }
    }
    scriptInput.focus();
  }

  function setPlaying(nextPlaying) {
    playing = Boolean(nextPlaying) && Number(speedSlider.value) > 0;
    playIcon.classList.toggle("is-hidden", playing);
    pauseIcon.classList.toggle("is-hidden", !playing);
    playPauseLabel.textContent = playing ? "暂停" : (reachedEnd ? "重新播放" : "继续");
    playPauseButton.setAttribute("aria-label", playPauseLabel.textContent);

    cancelAnimationFrame(frameId);
    frameId = null;
    lastFrameTime = 0;
    if (playing) frameId = requestAnimationFrame(tick);
  }

  function tick(now) {
    if (!playing || !inPlayer) return;
    if (!lastFrameTime) lastFrameTime = now;
    const deltaSeconds = Math.min((now - lastFrameTime) / 1000, 0.1);
    lastFrameTime = now;
    const pixelsPerSecond = Number(speedSlider.value) * 2.4;
    scrollViewport.scrollTop += pixelsPerSecond * deltaSeconds;
    updateProgress();

    if (scrollViewport.scrollTop >= maxScroll() - 0.5) {
      scrollViewport.scrollTop = maxScroll();
      reachedEnd = true;
      setPlaying(false);
      saveState();
      return;
    }
    frameId = requestAnimationFrame(tick);
  }

  function togglePlayback() {
    if (reachedEnd) {
      scrollViewport.scrollTop = 0;
      reachedEnd = false;
      updateProgress();
    }
    if (!playing && Number(speedSlider.value) === 0) {
      showToast("请先向上调整右侧速度");
      return;
    }
    setPlaying(!playing);
  }

  function maxScroll() {
    return Math.max(0, scrollViewport.scrollHeight - scrollViewport.clientHeight);
  }

  function updateProgress() {
    const max = maxScroll();
    const percentage = max ? (scrollViewport.scrollTop / max) * 100 : 0;
    progressFill.style.width = `${clamp(percentage, 0, 100)}%`;
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  scriptInput.addEventListener("input", () => {
    state.position = 0;
    const paragraphCount = scriptInput.value.split("\n").length;
    state.markers = state.markers.filter((marker) => marker < paragraphCount);
    updateMarkerCount();
    renderEditorMarkers();
    updateWordCount();
    scheduleSave();
  });

  speedSlider.addEventListener("input", () => {
    state.speed = Number(speedSlider.value);
    updateSpeedOutput();
    scheduleSave();
    if (inPlayer) setPlaying(state.speed > 0);
  });

  [fontFamily, fontSize, textColor, lineHeight, letterSpacing].forEach((control) => {
    control.addEventListener("input", formatChanged);
    control.addEventListener("change", formatChanged);
  });
  boldButton.addEventListener("click", () => toggleFormatButton(boldButton));
  underlineButton.addEventListener("click", () => toggleFormatButton(underlineButton));
  alignButtons.forEach((button) => button.addEventListener("click", () => {
    alignButtons.forEach((item) => {
      const active = item === button;
      item.classList.toggle("is-active", active);
      item.setAttribute("aria-pressed", String(active));
    });
    formatChanged();
  }));
  markerButton.addEventListener("click", toggleMarker);
  themeToggle.addEventListener("click", toggleTheme);
  loveButton.addEventListener("click", releaseHearts);
  brandTitle.addEventListener("input", scheduleSave);
  brandTitle.addEventListener("keydown", (event) => {
    if (event.key === "Enter") brandTitle.blur();
  });
  brandTitle.addEventListener("blur", () => {
    if (!brandTitle.value.trim()) brandTitle.value = DEFAULT_STATE.brandTitle;
    saveState();
  });
  scriptInput.addEventListener("scroll", positionEditorMarkers, { passive: true });

  scrollViewport.addEventListener("wheel", (event) => {
    if (!inPlayer) return;
    event.preventDefault();
    scrollViewport.scrollTop = clamp(scrollViewport.scrollTop + event.deltaY, 0, maxScroll());
    reachedEnd = scrollViewport.scrollTop >= maxScroll() - 0.5;
    updateProgress();
    scheduleSave();
  }, { passive: false });

  startButton.addEventListener("click", enterPlayer);
  playPauseButton.addEventListener("click", togglePlayback);
  backButton.addEventListener("click", leavePlayer);

  document.addEventListener("keydown", (event) => {
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      if (inPlayer || event.target === scriptInput) {
        event.preventDefault();
        jumpToNavigationPoint(event.key === "ArrowDown" ? 1 : -1);
        return;
      }
    }
    if (!inPlayer) return;
    if (event.code === "Space" && event.target !== speedSlider) {
      event.preventDefault();
      togglePlayback();
    } else if (event.key === "Escape" && !document.fullscreenElement) {
      leavePlayer();
    }
  });

  document.addEventListener("fullscreenchange", () => {
    if (inPlayer && !document.fullscreenElement) leavePlayer();
  });

  window.addEventListener("resize", () => {
    renderEditorMarkers();
    if (!inPlayer) return;
    scrollViewport.scrollTop = clamp(scrollViewport.scrollTop, 0, maxScroll());
    updateProgress();
  });

  window.addEventListener("beforeunload", saveState);

  if ("serviceWorker" in navigator && ["http:", "https:"].includes(location.protocol)) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./sw.js").catch(() => {
        showToast("离线功能暂未启用");
      });
    });
  }
})();

(() => {
  const VERSION = "accented_vocab_exp2_v0.2.0";
  const FULL_EXPOSURES_PER_WORD = 6;
  const DEMO_EXPOSURES_PER_WORD = 2;
  const LEARNING_ITI_MS = 650;
  const VISUAL_TO_AUDIO_MS = 750;
  const BREAK_EVERY_TRIALS = 25;
  const PRODUCTION_RECORD_MS = 5000;
  const RESPONSE_KEYS = { no: "f", yes: "j" };
  const PHASE_MODES = ["learning", "tests", "full"];
  const ACCENT_ALIASES = {
    j: "japanese",
    japanese: "japanese",
    e: "english",
    english: "english",
    c: "chinese",
    chinese: "chinese",
  };

  const ACCENT_SETS = {
    japanese: {
      id: "japanese",
      label: "Japanese-accent stimuli",
      basePath: "audio/japanese",
      talkers: ["j1", "j2", "j3", "j4", "j5", "j6"],
    },
    english: {
      id: "english",
      label: "English-accent stimuli",
      basePath: "audio/english",
      talkers: ["e1", "e2", "e3", "e4", "e5", "e6"],
    },
    chinese: {
      id: "chinese",
      label: "Chinese-accent stimuli",
      basePath: "audio/chinese",
      talkers: ["c1", "c2", "c3", "c4", "c5", "c6"],
    },
  };

  const stimuli = window.EXPERIMENT_STIMULI || [];
  const els = {
    participantId: document.getElementById("participant-id"),
    accentCondition: document.getElementById("accent-condition"),
    phaseMode: document.getElementById("phase-mode"),
    runMode: document.getElementById("run-mode"),
    autoDownload: document.getElementById("auto-download"),
    prepareBtn: document.getElementById("prepare-btn"),
    startBtn: document.getElementById("start-btn"),
    downloadBtn: document.getElementById("download-btn"),
    status: document.getElementById("status"),
    log: document.getElementById("log"),
    progressLabel: document.getElementById("progress-label"),
    progressFill: document.getElementById("progress-fill"),
    fixation: document.getElementById("fixation"),
    stimulusImg: document.getElementById("stimulus-img"),
    visualCard: document.getElementById("visual-card"),
    visualLabel: document.getElementById("visual-label"),
    visualNote: document.getElementById("visual-note"),
    soundCue: document.getElementById("sound-cue"),
    message: document.getElementById("message"),
    textResponse: document.getElementById("text-response"),
    responseHint: document.getElementById("response-hint"),
  };

  let prepared = null;
  let downloadBlobUrl = null;
  let lastDownloadMeta = null;
  let micStream = null;

  function setStatus(text) {
    els.status.textContent = text;
  }

  function setLog(text) {
    els.log.textContent = text;
  }

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function parseNumericId(participantId) {
    const digits = String(participantId).match(/\d+/g);
    return digits ? parseInt(digits.join(""), 10) : 1;
  }

  function mulberry32(seed) {
    return function rng() {
      seed |= 0;
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function seededShuffle(items, rng) {
    const out = items.slice();
    for (let i = out.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rng() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }

  function rotate(items, startItem) {
    const index = items.indexOf(startItem);
    if (index < 0) return items.slice();
    return items.slice(index).concat(items.slice(0, index));
  }

  function csvCell(value) {
    if (value === null || value === undefined) return "";
    const text = String(value);
    if (!/[",\n]/.test(text)) return text;
    return `"${text.replace(/"/g, '""')}"`;
  }

  function toCsv(rows) {
    if (!rows.length) return "";
    const keys = Array.from(rows.reduce((set, row) => {
      Object.keys(row).forEach((key) => set.add(key));
      return set;
    }, new Set()));
    return [
      keys.join(","),
      ...rows.map((row) => keys.map((key) => csvCell(row[key])).join(",")),
    ].join("\n");
  }

  function updateProgress(label, done, total) {
    const pct = total > 0 ? Math.min(100, Math.max(0, (done / total) * 100)) : 0;
    els.progressLabel.textContent = `${label}: ${done}/${total}`;
    els.progressFill.style.width = `${pct.toFixed(1)}%`;
  }

  function clearStage() {
    els.fixation.style.display = "none";
    els.stimulusImg.style.display = "none";
    els.visualCard.style.display = "none";
    els.soundCue.style.display = "none";
    els.message.style.display = "none";
    els.textResponse.classList.add("hidden");
    els.responseHint.textContent = "";
  }

  function showMessage(text) {
    clearStage();
    els.message.textContent = text;
    els.message.style.display = "block";
  }

  function showFixation() {
    clearStage();
    els.fixation.style.display = "block";
  }

  function showSoundCue(text = "音声") {
    clearStage();
    els.soundCue.textContent = text;
    els.soundCue.style.display = "flex";
  }

  function showVisual(item, imageMap, note) {
    clearStage();
    const img = imageMap.get(item.word);
    if (img) {
      els.stimulusImg.src = img.src;
      els.stimulusImg.alt = item.ja || item.word;
      els.stimulusImg.style.display = "block";
      return "image";
    }
    els.visualLabel.textContent = item.ja || item.word;
    els.visualNote.textContent = note || "Image asset missing; showing gloss placeholder.";
    els.visualCard.style.display = "flex";
    return "gloss_placeholder";
  }

  function waitForSpace(promptText) {
    showMessage(promptText);
    return new Promise((resolve) => {
      const handler = (ev) => {
        if (ev.code === "Space") {
          ev.preventDefault();
          document.removeEventListener("keydown", handler);
          resolve();
        }
      };
      document.addEventListener("keydown", handler);
    });
  }

  function waitForKey(keys, startMs, timeoutMs = null) {
    return new Promise((resolve) => {
      let timer = null;
      const cleanup = () => {
        document.removeEventListener("keydown", handler);
        if (timer) clearTimeout(timer);
      };
      const handler = (ev) => {
        const key = ev.key.toLowerCase();
        if (!keys.includes(key)) return;
        cleanup();
        resolve({ key, rt_ms: performance.now() - startMs, timeout: false });
      };
      document.addEventListener("keydown", handler);
      if (timeoutMs !== null) {
        timer = setTimeout(() => {
          cleanup();
          resolve({ key: "", rt_ms: null, timeout: true });
        }, timeoutMs);
      }
    });
  }

  function waitForTextResponse(startMs) {
    els.textResponse.value = "";
    els.textResponse.classList.remove("hidden");
    els.textResponse.focus();
    return new Promise((resolve) => {
      const handler = (ev) => {
        if (ev.key !== "Enter") return;
        ev.preventDefault();
        els.textResponse.removeEventListener("keydown", handler);
        const response = els.textResponse.value.trim();
        els.textResponse.classList.add("hidden");
        resolve({ response, rt_ms: performance.now() - startMs });
      };
      els.textResponse.addEventListener("keydown", handler);
    });
  }

  function normalizeAccentId(value) {
    return ACCENT_ALIASES[String(value || "").trim().toLowerCase()] || "";
  }

  function buildAssignment(participantId, requestedAccent, mode, phaseMode) {
    const numericId = Math.max(1, parseNumericId(participantId));
    const accentId = normalizeAccentId(requestedAccent);
    const accent = ACCENT_SETS[accentId];
    const cohortIndex = numericId - 1;
    const counterbalanceCell = cohortIndex % 24;
    const listCell = Math.floor(counterbalanceCell / 6) % 2;
    const orderCell = Math.floor(counterbalanceCell / 12) % 2;
    const talkerCell = counterbalanceCell % accent.talkers.length;
    const singleList = listCell === 0 ? 1 : 2;
    const multipleList = singleList === 1 ? 2 : 1;
    const conditionOrder = orderCell === 0
      ? ["single", "multiple"]
      : ["multiple", "single"];
    const singleTalker = accent.talkers[talkerCell];
    const multiTalkers = rotate(accent.talkers, singleTalker);
    const exposures = mode === "demo" ? DEMO_EXPOSURES_PER_WORD : FULL_EXPOSURES_PER_WORD;
    const maxPerList = mode === "demo" ? 4 : Infinity;
    const rng1 = mulberry32(numericId * 1000 + 11);
    const rng2 = mulberry32(numericId * 1000 + 17);
    const singleWords = seededShuffle(stimuli.filter((item) => item.list === singleList), rng1).slice(0, maxPerList);
    const multipleWords = seededShuffle(stimuli.filter((item) => item.list === multipleList), rng2).slice(0, maxPerList);
    const allWords = singleWords.concat(multipleWords);
    const conditionByWord = new Map();
    singleWords.forEach((item) => conditionByWord.set(item.word, "single"));
    multipleWords.forEach((item) => conditionByWord.set(item.word, "multiple"));

    const learningTrials = [];
    let block = 0;
    for (let exposure = 1; exposure <= exposures; exposure += 1) {
      conditionOrder.forEach((condition) => {
        const words = condition === "single" ? singleWords : multipleWords;
        const talker = condition === "single" ? singleTalker : multiTalkers[(exposure - 1) % multiTalkers.length];
        block += 1;
        seededShuffle(words, mulberry32(numericId * 10000 + exposure * 101 + block)).forEach((item, index) => {
          learningTrials.push({
            phase: "learning",
            condition,
            exposure,
            block,
            block_index: index + 1,
            item,
            talker,
          });
        });
      });
    }

    const testWords = seededShuffle(allWords, mulberry32(numericId * 1000 + 23));
    const l2ToL1Trials = testWords.map((item, index) => ({
      phase: "l2_to_l1",
      item,
      condition: conditionByWord.get(item.word),
      talker: accent.talkers[(numericId + index) % accent.talkers.length],
    }));
    const productionTrials = seededShuffle(allWords, mulberry32(numericId * 1000 + 29)).map((item) => ({
      phase: "production",
      item,
      condition: conditionByWord.get(item.word),
    }));
    const matchingWords = mode === "demo" ? testWords.slice(0, 6) : testWords;
    const deranged = derange(matchingWords, mulberry32(numericId * 1000 + 31));
    const matchingTrials = seededShuffle(matchingWords.flatMap((item, index) => ([
      {
        phase: "picture_matching",
        item,
        audioItem: item,
        visualCondition: conditionByWord.get(item.word),
        audioCondition: conditionByWord.get(item.word),
        match: true,
        expected_key: RESPONSE_KEYS.yes,
        talker: accent.talkers[(numericId + index) % accent.talkers.length],
      },
      {
        phase: "picture_matching",
        item,
        audioItem: deranged[index],
        visualCondition: conditionByWord.get(item.word),
        audioCondition: conditionByWord.get(deranged[index].word),
        match: false,
        expected_key: RESPONSE_KEYS.no,
        talker: accent.talkers[(numericId + index + 2) % accent.talkers.length],
      },
    ])), mulberry32(numericId * 1000 + 37));

    return {
      version: VERSION,
      participantId,
      numericId,
      mode,
      phaseMode,
      counterbalanceCell: counterbalanceCell + 1,
      accent,
      singleList,
      multipleList,
      conditionOrder,
      singleTalker,
      multiTalkers,
      exposures,
      allWords,
      conditionByWord: Object.fromEntries(conditionByWord),
      learningTrials,
      l2ToL1Trials,
      productionTrials,
      matchingTrials,
    };
  }

  function derange(items, rng) {
    if (items.length < 2) return items.slice();
    const out = seededShuffle(items, rng);
    for (let i = 0; i < items.length; i += 1) {
      if (out[i].word === items[i].word) {
        const j = (i + 1) % items.length;
        [out[i], out[j]] = [out[j], out[i]];
      }
    }
    return out;
  }

  function audioPath(accent, talker, item) {
    return `${accent.basePath}/${talker}/${item.word}.wav`;
  }

  function collectAudioPaths(assignment) {
    const paths = new Set();
    if (assignment.phaseMode === "learning" || assignment.phaseMode === "full") {
      assignment.learningTrials.forEach((trial) => paths.add(audioPath(assignment.accent, trial.talker, trial.item)));
    }
    if (assignment.phaseMode === "tests" || assignment.phaseMode === "full") {
      assignment.l2ToL1Trials.forEach((trial) => paths.add(audioPath(assignment.accent, trial.talker, trial.item)));
      assignment.matchingTrials.forEach((trial) => paths.add(audioPath(assignment.accent, trial.talker, trial.audioItem)));
    }
    return Array.from(paths);
  }

  function preloadAudio(path) {
    return new Promise((resolve) => {
      const audio = new Audio();
      let settled = false;
      const done = (ok, message = "") => {
        if (settled) return;
        settled = true;
        audio.oncanplaythrough = null;
        audio.onerror = null;
        resolve({ ok, path, audio: ok ? audio : null, message });
      };
      audio.preload = "auto";
      audio.oncanplaythrough = () => done(true);
      audio.onerror = () => done(false, "audio load failed");
      audio.src = path;
      audio.load();
      setTimeout(() => {
        if (!audio.readyState) done(false, "audio load timed out");
      }, 8000);
    });
  }

  function preloadImage(item) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve({ item, img });
      img.onerror = () => resolve({ item, img: null });
      img.src = item.image;
    });
  }

  async function preloadAssets(assignment) {
    const audioPaths = collectAudioPaths(assignment);
    const audioMap = new Map();
    const missingAudio = [];
    for (let i = 0; i < audioPaths.length; i += 1) {
      setStatus(`音声プリロード中 ${i + 1}/${audioPaths.length}`);
      const result = await preloadAudio(audioPaths[i]);
      if (result.ok) audioMap.set(result.path, result.audio);
      else missingAudio.push(result.path);
    }

    const imageMap = new Map();
    const imageResults = await Promise.all(assignment.allWords.map(preloadImage));
    imageResults.forEach(({ item, img }) => {
      if (img) imageMap.set(item.word, img);
    });

    if (missingAudio.length) {
      const sample = missingAudio.slice(0, 8).join("\n");
      throw new Error(`音声ファイルが不足しています (${missingAudio.length}件)。\n${sample}`);
    }
    return {
      audioMap,
      imageMap,
      missingImages: assignment.allWords.length - imageMap.size,
    };
  }

  async function playAudio(audioMap, path) {
    const baseAudio = audioMap.get(path);
    if (!baseAudio) throw new Error(`Audio not preloaded: ${path}`);
    const audio = baseAudio.cloneNode(true);
    audio.currentTime = 0;
    const ended = new Promise((resolve, reject) => {
      audio.onended = resolve;
      audio.onerror = () => reject(new Error(`Audio playback failed: ${path}`));
    });
    await audio.play();
    await ended;
  }

  async function ensureMicStream() {
    if (micStream) return micStream;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error("このブラウザではマイク録音を利用できません。");
    }
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    return micStream;
  }

  function encodeWav(buffers, sampleRate) {
    const length = buffers.reduce((sum, buffer) => sum + buffer.length, 0);
    const pcm = new Float32Array(length);
    let offset = 0;
    buffers.forEach((buffer) => {
      pcm.set(buffer, offset);
      offset += buffer.length;
    });

    const dataSize = pcm.length * 2;
    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);
    writeString(view, 0, "RIFF");
    view.setUint32(4, 36 + dataSize, true);
    writeString(view, 8, "WAVE");
    writeString(view, 12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeString(view, 36, "data");
    view.setUint32(40, dataSize, true);
    let pos = 44;
    for (let i = 0; i < pcm.length; i += 1) {
      const s = Math.max(-1, Math.min(1, pcm[i]));
      view.setInt16(pos, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      pos += 2;
    }
    return new Blob([view], { type: "audio/wav" });
  }

  function writeString(view, offset, text) {
    for (let i = 0; i < text.length; i += 1) {
      view.setUint8(offset + i, text.charCodeAt(i));
    }
  }

  async function recordWav(durationMs) {
    const stream = await ensureMicStream();
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const source = audioContext.createMediaStreamSource(stream);
    const processor = audioContext.createScriptProcessor(4096, 1, 1);
    const mute = audioContext.createGain();
    mute.gain.value = 0;
    const buffers = [];
    processor.onaudioprocess = (event) => {
      buffers.push(new Float32Array(event.inputBuffer.getChannelData(0)));
    };
    source.connect(processor);
    processor.connect(mute);
    mute.connect(audioContext.destination);
    const startedAt = performance.now();
    await delay(durationMs);
    const endedAt = performance.now();
    const sampleRate = audioContext.sampleRate;
    const blob = encodeWav(buffers, sampleRate);
    processor.disconnect();
    source.disconnect();
    mute.disconnect();
    await audioContext.close();
    return {
      blob,
      startedAt,
      endedAt,
      duration_ms: endedAt - startedAt,
      sample_rate_hz: sampleRate,
    };
  }

  async function runLearning(assignment, assets, rows) {
    await waitForSpace(
      `Learning phase\n\n音声を聞き、表示された概念と英単語の対応を覚えてください。\nスペースキーで開始`
    );
    const total = assignment.learningTrials.length;
    const start = performance.now();
    for (let i = 0; i < total; i += 1) {
      const trial = assignment.learningTrials[i];
      updateProgress("Learning", i + 1, total);
      const visualMode = showVisual(trial.item, assets.imageMap, "Learning cue");
      await delay(VISUAL_TO_AUDIO_MS);
      const path = audioPath(assignment.accent, trial.talker, trial.item);
      const audioOnsetMs = performance.now() - start;
      await playAudio(assets.audioMap, path);
      rows.push(baseRow(assignment, {
        phase: "learning",
        trial: i + 1,
        condition: trial.condition,
        exposure: trial.exposure,
        block: trial.block,
        word: trial.item.word,
        item_id: trial.item.id,
        talker: trial.talker,
        audio_file: path,
        visual_mode: visualMode,
        audio_onset_ms: audioOnsetMs.toFixed(1),
      }));
      showFixation();
      await delay(LEARNING_ITI_MS);
      if ((i + 1) < total && (i + 1) % BREAK_EVERY_TRIALS === 0) {
        await waitForSpace(`休憩\n\n${i + 1}/${total} 試行が終わりました。\nスペースキーで続行`);
      }
    }
  }

  async function runL2ToL1(assignment, assets, rows) {
    await waitForSpace(
      `L2 to L1 test\n\n音声を聞いて、意味を日本語で入力してください。\n入力後 Enter キーで進みます。\nスペースキーで開始`
    );
    const total = assignment.l2ToL1Trials.length;
    for (let i = 0; i < total; i += 1) {
      const trial = assignment.l2ToL1Trials[i];
      updateProgress("L2 to L1", i + 1, total);
      showSoundCue("音声");
      const path = audioPath(assignment.accent, trial.talker, trial.item);
      const onset = performance.now();
      await playAudio(assets.audioMap, path);
      els.responseHint.textContent = "日本語訳を入力して Enter";
      const response = await waitForTextResponse(onset);
      rows.push(baseRow(assignment, {
        phase: "l2_to_l1",
        trial: i + 1,
        condition: trial.condition,
        word: trial.item.word,
        item_id: trial.item.id,
        expected_l1: trial.item.ja,
        talker: trial.talker,
        audio_file: path,
        typed_response: response.response,
        rt_ms: response.rt_ms.toFixed(1),
      }));
      showFixation();
      await delay(LEARNING_ITI_MS);
    }
  }

  async function runProduction(assignment, assets, rows, recordings) {
    await waitForSpace(
      `Production test\n\n表示された概念の英単語を声に出してください。\n各試行は${(PRODUCTION_RECORD_MS / 1000).toFixed(0)}秒録音されます。\nスペースキーで開始`
    );
    await ensureMicStream();
    const total = assignment.productionTrials.length;
    for (let i = 0; i < total; i += 1) {
      const trial = assignment.productionTrials[i];
      updateProgress("Production", i + 1, total);
      const visualMode = showVisual(trial.item, assets.imageMap, "Production cue");
      els.responseHint.textContent = "録音中";
      const recording = await recordWav(PRODUCTION_RECORD_MS);
      const fileName = `${assignment.participantId}_production_${String(i + 1).padStart(3, "0")}_${trial.item.word}.wav`;
      recordings.push({ fileName, blob: recording.blob });
      rows.push(baseRow(assignment, {
        phase: "production",
        trial: i + 1,
        condition: trial.condition,
        word: trial.item.word,
        item_id: trial.item.id,
        expected_l1: trial.item.ja,
        visual_mode: visualMode,
        recording_file: fileName,
        recording_duration_ms: recording.duration_ms.toFixed(1),
        recording_sample_rate_hz: recording.sample_rate_hz,
      }));
      showFixation();
      await delay(LEARNING_ITI_MS);
    }
  }

  async function runPictureMatching(assignment, assets, rows) {
    await waitForSpace(
      `Picture matching test\n\n表示された概念と音声が一致するか判断してください。\nF = 不一致、J = 一致\nスペースキーで開始`
    );
    const total = assignment.matchingTrials.length;
    for (let i = 0; i < total; i += 1) {
      const trial = assignment.matchingTrials[i];
      updateProgress("Picture matching", i + 1, total);
      const visualMode = showVisual(trial.item, assets.imageMap, "Matching cue");
      await delay(VISUAL_TO_AUDIO_MS);
      const path = audioPath(assignment.accent, trial.talker, trial.audioItem);
      const onset = performance.now();
      await playAudio(assets.audioMap, path);
      els.responseHint.textContent = "F = 不一致 / J = 一致";
      const response = await waitForKey([RESPONSE_KEYS.no, RESPONSE_KEYS.yes], onset, 6000);
      rows.push(baseRow(assignment, {
        phase: "picture_matching",
        trial: i + 1,
        visual_condition: trial.visualCondition,
        audio_condition: trial.audioCondition,
        visual_word: trial.item.word,
        audio_word: trial.audioItem.word,
        match: trial.match,
        expected_key: trial.expected_key,
        response_key: response.key,
        correct: response.key === trial.expected_key ? 1 : 0,
        rt_ms: response.rt_ms === null ? "" : response.rt_ms.toFixed(1),
        timeout: response.timeout ? 1 : 0,
        talker: trial.talker,
        audio_file: path,
        visual_mode: visualMode,
      }));
      showFixation();
      await delay(LEARNING_ITI_MS);
    }
  }

  function baseRow(assignment, row) {
    return {
      version: assignment.version,
      participant_id: assignment.participantId,
      numeric_id: assignment.numericId,
      mode: assignment.mode,
      phase_mode: assignment.phaseMode,
      counterbalance_cell: assignment.counterbalanceCell,
      accent_condition: assignment.accent.id,
      variability_single_list: assignment.singleList,
      variability_multiple_list: assignment.multipleList,
      condition_order: assignment.conditionOrder.join(">"),
      single_talker: assignment.singleTalker,
      ...row,
    };
  }

  async function buildResultPackage(assignment, rows, recordings) {
    if (!window.JSZip) {
      return {
        blob: new Blob([toCsv(rows)], { type: "text/csv;charset=utf-8" }),
        extension: "csv",
        label: "CSV",
      };
    }
    const zip = new JSZip();
    zip.file(`${assignment.participantId}_results.csv`, toCsv(rows));
    zip.file(`${assignment.participantId}_assignment.json`, JSON.stringify({
      version: assignment.version,
      participant_id: assignment.participantId,
      mode: assignment.mode,
      phase_mode: assignment.phaseMode,
      counterbalance_cell: assignment.counterbalanceCell,
      accent_condition: assignment.accent.id,
      single_list: assignment.singleList,
      multiple_list: assignment.multipleList,
      condition_order: assignment.conditionOrder,
      single_talker: assignment.singleTalker,
      multi_talkers: assignment.multiTalkers,
      exposures_per_word: assignment.exposures,
      words: assignment.allWords.map((item) => ({ id: item.id, word: item.word, list: item.list, ja: item.ja })),
      condition_by_word: assignment.conditionByWord,
    }, null, 2));
    recordings.forEach((recording) => {
      zip.file(`recordings/${recording.fileName}`, recording.blob);
    });
    return {
      blob: await zip.generateAsync({ type: "blob" }),
      extension: "zip",
      label: "ZIP",
    };
  }

  async function prepare() {
    const participantId = els.participantId.value.trim();
    if (!participantId) {
      setStatus("参加者IDを入力してください。");
      return;
    }
    const accentId = normalizeAccentId(els.accentCondition.value);
    if (!accentId) {
      setStatus("アクセント条件を J / E / C から選択してください。");
      return;
    }
    const phaseMode = els.phaseMode.value;
    if (!PHASE_MODES.includes(phaseMode)) {
      setStatus("セッションを選択してください。");
      return;
    }
    els.prepareBtn.disabled = true;
    els.startBtn.disabled = true;
    els.downloadBtn.disabled = true;
    setLog("");
    setStatus("条件割り当てを作成しています...");
    try {
      const assignment = buildAssignment(participantId, accentId, els.runMode.value, phaseMode);
      const assets = await preloadAssets(assignment);
      prepared = { assignment, assets };
      els.startBtn.disabled = false;
      setStatus("準備完了。開始できます。");
      setLog([
        `version: ${assignment.version}`,
        `phase: ${assignment.phaseMode}`,
        `counterbalance_cell: ${assignment.counterbalanceCell}/24`,
        `accent: ${assignment.accent.label}`,
        `single_list: ${assignment.singleList}`,
        `multiple_list: ${assignment.multipleList}`,
        `condition_order: ${assignment.conditionOrder.join(" > ")}`,
        `single_talker: ${assignment.singleTalker}`,
        `multi_talkers: ${assignment.multiTalkers.join(", ")}`,
        `learning_trials: ${assignment.learningTrials.length}`,
        `l2_to_l1_trials: ${assignment.l2ToL1Trials.length}`,
        `production_trials: ${assignment.productionTrials.length}`,
        `picture_matching_trials: ${assignment.matchingTrials.length}`,
        `missing_images: ${assets.missingImages}`,
      ].join("\n"));
    } catch (error) {
      prepared = null;
      setStatus(`準備エラー: ${error.message}`);
      setLog("音声ファイルが不足している場合は、READMEの命名規則に沿って仮音声または本番音声を追加してください。");
    } finally {
      els.prepareBtn.disabled = false;
    }
  }

  async function start() {
    if (!prepared) {
      setStatus("先に準備を実行してください。");
      return;
    }
    els.startBtn.disabled = true;
    els.prepareBtn.disabled = true;
    els.downloadBtn.disabled = true;
    document.body.classList.add("running");
    const rows = [];
    const recordings = [];
    const { assignment, assets } = prepared;
    try {
      if (assignment.phaseMode === "learning" || assignment.phaseMode === "full") {
        await runLearning(assignment, assets, rows);
      }
      if (assignment.phaseMode === "tests" || assignment.phaseMode === "full") {
        await runL2ToL1(assignment, assets, rows);
        await runProduction(assignment, assets, rows, recordings);
        await runPictureMatching(assignment, assets, rows);
      }
      if (assignment.phaseMode === "learning") {
        showMessage("学習セッションは終了しました。\n結果ファイルを作成しています。");
      } else {
        showMessage("終了しました。\n結果ファイルを作成しています。");
      }
      const resultPackage = await buildResultPackage(assignment, rows, recordings);
      if (downloadBlobUrl) URL.revokeObjectURL(downloadBlobUrl);
      downloadBlobUrl = URL.createObjectURL(resultPackage.blob);
      lastDownloadMeta = {
        participantId: assignment.participantId,
        phaseMode: assignment.phaseMode,
        extension: resultPackage.extension,
        label: resultPackage.label,
      };
      els.downloadBtn.disabled = false;
      els.prepareBtn.disabled = false;
      if (els.autoDownload.checked) {
        downloadResults();
        setStatus(`完了。結果${resultPackage.label}を自動ダウンロードしました。必要なら再ダウンロードできます。`);
      } else {
        setStatus(`完了。結果${resultPackage.label}をダウンロードしてください。`);
      }
      setLog(`rows: ${rows.length}\nrecordings: ${recordings.length}\nresult_file_type: ${resultPackage.extension}`);
    } catch (error) {
      setStatus(`実行エラー: ${error.message}`);
      setLog(error.stack || String(error));
      els.prepareBtn.disabled = false;
    } finally {
      document.body.classList.remove("running");
      prepared = null;
    }
  }

  function downloadResults() {
    if (!downloadBlobUrl) {
      setStatus("ダウンロードできる結果ファイルがまだありません。");
      return;
    }
    const participantId = lastDownloadMeta?.participantId || els.participantId.value.trim() || "participant";
    const phaseMode = lastDownloadMeta?.phaseMode || els.phaseMode.value || "session";
    const extension = lastDownloadMeta?.extension || "zip";
    const a = document.createElement("a");
    a.href = downloadBlobUrl;
    a.download = `${participantId}_${phaseMode}_accent_variability_results.${extension}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  function applyQueryDefaults() {
    const params = new URLSearchParams(window.location.search);
    const accent = params.get("accent");
    const phase = params.get("phase");
    const mode = params.get("mode");
    const pid = params.get("participant") || params.get("pid");
    const autoDownload = params.get("autodownload");
    const accentId = normalizeAccentId(accent);
    if (accentId) els.accentCondition.value = accentId;
    if (phase && PHASE_MODES.includes(phase)) els.phaseMode.value = phase;
    if (mode && ["full", "demo"].includes(mode)) els.runMode.value = mode;
    if (pid) els.participantId.value = pid;
    if (autoDownload !== null) {
      els.autoDownload.checked = !["0", "false", "no", "off"].includes(autoDownload.trim().toLowerCase());
    }
  }

  window.addEventListener("beforeunload", (event) => {
    if (!document.body.classList.contains("running")) return;
    event.preventDefault();
    event.returnValue = "";
  });

  els.prepareBtn.addEventListener("click", prepare);
  els.startBtn.addEventListener("click", start);
  els.downloadBtn.addEventListener("click", downloadResults);
  applyQueryDefaults();
})();

(() => {
  const VERSION = "accented_vocab_exp2_v0.6.0";
  const FULL_EXPOSURES_PER_WORD = 6;
  const LEARNING_ITI_MS = 650;
  const VISUAL_TO_AUDIO_MS = 750;
  const BREAK_EVERY_TRIALS = 24;
  const PRODUCTION_RECORD_MS = 5000;
  const L2_TRANSLATION_RECORD_MS = 5000;
  const PRACTICE_RECORD_MS = 4000;
  const RESPONSE_KEYS = { no: "f", yes: "j" };
  const PHASE_MODES = ["learning", "tests", "full"];
  const TEST_ACCENT_IDS = ["english", "japanese", "chinese"];
  const CHECKPOINT_PREFIX = "vocabulary_task_checkpoint:";
  const TASK_TITLES = {
    pictureNaming: "Picture Naming Task",
    l2ToL1: "L2-to-L1 Translation Task",
    pictureMatching: "Picture Matching Task",
  };
  const ACCENT_ALIASES = {
    j: "japanese",
    japanese: "japanese",
    e: "english",
    english: "english",
    c: "chinese",
    chinese: "chinese",
  };

  const DISPLAY_CODES = {
    japanese: "J",
    english: "E",
    chinese: "C",
  };

  const DEBUG_MODE = new URLSearchParams(window.location.search).get("debug") === "1";

  const ACCENT_SETS = {
    japanese: {
      id: "japanese",
      label: "Code J",
      basePath: "audio/japanese",
      talkers: ["j1", "j2", "j3", "j4", "j5", "j6"],
      testTalkers: ["j_test"],
    },
    english: {
      id: "english",
      label: "Code E",
      basePath: "audio/english",
      talkers: ["e1", "e2", "e3", "e4", "e5", "e6"],
      testTalkers: ["e_test"],
    },
    chinese: {
      id: "chinese",
      label: "Code C",
      basePath: "audio/chinese",
      talkers: ["c1", "c2", "c3", "c4", "c5", "c6"],
      testTalkers: ["c_test"],
    },
  };

  const PRACTICE_STIMULI = [
    { id: "practice_abacus", word: "abacus", ja: "そろばん", image: "images/abacus.jpg" },
    { id: "practice_binoculars", word: "binoculars", ja: "双眼鏡", image: "images/binoculars.jpg" },
    { id: "practice_thermometer", word: "thermometer", ja: "温度計", image: "images/thermometer.jpg" },
    { id: "practice_xylophone", word: "xylophone", ja: "木琴", image: "images/xylophone.jpg" },
  ];

  const stimuli = window.EXPERIMENT_STIMULI || [];
  const els = {
    participantId: document.getElementById("participant-id"),
    accentCondition: document.getElementById("accent-condition"),
    sessionBadge: document.querySelector(".session-badge"),
    phaseMode: document.getElementById("phase-mode"),
    autoDownload: document.getElementById("auto-download"),
    prepareBtn: document.getElementById("prepare-btn"),
    startBtn: document.getElementById("start-btn"),
    downloadBtn: document.getElementById("download-btn"),
    interruptBtn: document.getElementById("interrupt-btn"),
    recoveryCard: document.getElementById("recovery-card"),
    recoverySummary: document.getElementById("recovery-summary"),
    recoveryDownloadBtn: document.getElementById("recovery-download-btn"),
    recoveryClearBtn: document.getElementById("recovery-clear-btn"),
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
  let activeRun = null;
  let interruptRequested = false;

  function setStatus(text) {
    els.status.textContent = text;
    if (els.sessionBadge && text) {
      els.sessionBadge.textContent = text.split("。")[0].slice(0, 16);
    }
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

  function buildBalancedTestAccentIds(count, numericId, salt) {
    const offset = (numericId - 1) % TEST_ACCENT_IDS.length;
    const ids = Array.from({ length: count }, (_, index) => (
      TEST_ACCENT_IDS[(index + offset) % TEST_ACCENT_IDS.length]
    ));
    return seededShuffle(ids, mulberry32(numericId * 1000 + salt));
  }

  function pickTestTalker(accent, numericId, index) {
    const testTalkers = accent.testTalkers && accent.testTalkers.length
      ? accent.testTalkers
      : accent.talkers;
    return testTalkers[(numericId + index) % testTalkers.length];
  }

  function countByValue(values) {
    return values.reduce((counts, value) => {
      counts[value] = (counts[value] || 0) + 1;
      return counts;
    }, {});
  }

  function safeFilePart(value) {
    return String(value || "")
      .trim()
      .replace(/[^a-z0-9_-]+/gi, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 80) || "item";
  }

  function recordingFileName(assignment, taskSlug, trialNumber, item, practice = false) {
    const prefix = practice ? "practice_" : "";
    const trialText = String(trialNumber).padStart(3, "0");
    return `${prefix}${safeFilePart(assignment.participantId)}_${taskSlug}_${trialText}_${safeFilePart(item.word)}.wav`;
  }

  function isChromeBrowser() {
    if (typeof navigator === "undefined") return false;
    const ua = navigator.userAgent || "";
    const brandText = navigator.userAgentData?.brands
      ? navigator.userAgentData.brands.map((brand) => brand.brand).join(" ")
      : "";
    const hasChrome = /Google Chrome|Chrome\//.test(`${brandText} ${ua}`);
    const excluded = /Edg\/|OPR\/|Opera|SamsungBrowser|CriOS|FxiOS/.test(ua);
    return hasChrome && !excluded;
  }

  function enforceChromeGuard() {
    if (isChromeBrowser()) return true;
    els.prepareBtn.disabled = true;
    els.startBtn.disabled = true;
    setStatus("Google Chromeで開いてください。");
    setLog("この課題では音声再生とWAV録音を安定させるため、Google Chromeを使用してください。");
    return false;
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

  function sessionCodeForAccent(accentId) {
    return DISPLAY_CODES[accentId] || "";
  }

  function checkpointKey(assignment) {
    return `${CHECKPOINT_PREFIX}${assignment.participantId}:${assignment.phaseMode}:${sessionCodeForAccent(assignment.accent.id)}`;
  }

  function saveCheckpoint(assignment, rows, status = "running") {
    if (!assignment || !Array.isArray(rows)) return;
    try {
      const payload = {
        version: assignment.version,
        saved_at: new Date().toISOString(),
        status,
        participant_id: assignment.participantId,
        session_code: sessionCodeForAccent(assignment.accent.id),
        phase_mode: assignment.phaseMode,
        mode: assignment.mode,
        rows,
      };
      localStorage.setItem(checkpointKey(assignment), JSON.stringify(payload));
      updateRecoveryCard();
    } catch (error) {
      if (DEBUG_MODE) setLog(`checkpoint_save_error: ${error.message}`);
    }
  }

  function clearCheckpoint(assignment) {
    try {
      localStorage.removeItem(checkpointKey(assignment));
      updateRecoveryCard();
    } catch (error) {
      if (DEBUG_MODE) setLog(`checkpoint_clear_error: ${error.message}`);
    }
  }

  function checkpointList() {
    const out = [];
    try {
      for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i);
        if (!key || !key.startsWith(CHECKPOINT_PREFIX)) continue;
        const item = JSON.parse(localStorage.getItem(key) || "{}");
        out.push({ key, ...item });
      }
    } catch (error) {
      if (DEBUG_MODE) setLog(`checkpoint_read_error: ${error.message}`);
    }
    return out.sort((a, b) => String(b.saved_at || "").localeCompare(String(a.saved_at || "")));
  }

  function latestCheckpoint() {
    return checkpointList()[0] || null;
  }

  function updateRecoveryCard() {
    if (!els.recoveryCard) return;
    const checkpoint = latestCheckpoint();
    if (!checkpoint) {
      els.recoveryCard.classList.add("hidden");
      return;
    }
    const savedAt = checkpoint.saved_at ? new Date(checkpoint.saved_at).toLocaleString("ja-JP") : "";
    const rowCount = Array.isArray(checkpoint.rows) ? checkpoint.rows.length : 0;
    els.recoverySummary.textContent = `参加者ID ${checkpoint.participant_id || "-"}、${rowCount}行、${savedAt}`;
    els.recoveryCard.classList.remove("hidden");
  }

  function downloadCheckpoint() {
    const checkpoint = latestCheckpoint();
    if (!checkpoint) {
      setStatus("保存できる途中の記録はありません。");
      return;
    }
    const rows = Array.isArray(checkpoint.rows) ? checkpoint.rows : [];
    const blob = rows.length
      ? new Blob([toCsv(rows)], { type: "text/csv;charset=utf-8" })
      : new Blob([JSON.stringify(checkpoint, null, 2)], { type: "application/json;charset=utf-8" });
    const extension = rows.length ? "csv" : "json";
    const participantId = checkpoint.participant_id || "participant";
    const phaseMode = checkpoint.phase_mode || "session";
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${participantId}_${phaseMode}_vocabulary_task_partial.${extension}`;
    document.body.appendChild(a);
    a.click();
    URL.revokeObjectURL(a.href);
    a.remove();
    setStatus("途中の記録を保存しました。");
  }

  function clearLatestCheckpoint() {
    const checkpoint = latestCheckpoint();
    if (!checkpoint) return;
    localStorage.removeItem(checkpoint.key);
    updateRecoveryCard();
    setStatus("途中の記録を消去しました。");
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
    els.visualNote.textContent = note || "";
    els.visualNote.style.display = note ? "block" : "none";
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

  function buildAssignment(participantId, requestedAccent, phaseMode) {
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
    const exposures = FULL_EXPOSURES_PER_WORD;
    const rng1 = mulberry32(numericId * 1000 + 11);
    const rng2 = mulberry32(numericId * 1000 + 17);
    const singleWords = seededShuffle(stimuli.filter((item) => item.list === singleList), rng1);
    const multipleWords = seededShuffle(stimuli.filter((item) => item.list === multipleList), rng2);
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
    const l2ToL1AccentIds = buildBalancedTestAccentIds(testWords.length, numericId, 41);
    const l2ToL1Trials = testWords.map((item, index) => ({
      phase: "l2_to_l1",
      item,
      condition: conditionByWord.get(item.word),
      audioAccentId: l2ToL1AccentIds[index],
      talker: pickTestTalker(ACCENT_SETS[l2ToL1AccentIds[index]], numericId, index),
    }));
    const productionTrials = seededShuffle(allWords, mulberry32(numericId * 1000 + 29)).map((item) => ({
      phase: "picture_naming",
      item,
      condition: conditionByWord.get(item.word),
    }));
    const matchingWords = testWords;
    const deranged = derange(matchingWords, mulberry32(numericId * 1000 + 31));
    const matchingBaseTrials = matchingWords.flatMap((item, index) => ([
      {
        phase: "picture_matching",
        item,
        audioItem: item,
        visualCondition: conditionByWord.get(item.word),
        audioCondition: conditionByWord.get(item.word),
        match: true,
        expected_key: RESPONSE_KEYS.yes,
      },
      {
        phase: "picture_matching",
        item,
        audioItem: deranged[index],
        visualCondition: conditionByWord.get(item.word),
        audioCondition: conditionByWord.get(deranged[index].word),
        match: false,
        expected_key: RESPONSE_KEYS.no,
      },
    ]));
    const matchingAccentIds = buildBalancedTestAccentIds(matchingBaseTrials.length, numericId, 43);
    const matchingTrials = seededShuffle(matchingBaseTrials.map((trial, index) => ({
      ...trial,
      audioAccentId: matchingAccentIds[index],
      talker: pickTestTalker(ACCENT_SETS[matchingAccentIds[index]], numericId, index),
    })), mulberry32(numericId * 1000 + 37));
    const pictureNamingPracticeTrials = PRACTICE_STIMULI.slice(0, 2).map((item, index) => ({
      phase: "picture_naming_practice",
      item,
      practice: true,
      practiceIndex: index + 1,
    }));
    const l2ToL1PracticeAccentIds = buildBalancedTestAccentIds(2, numericId, 47);
    const l2ToL1PracticeTrials = PRACTICE_STIMULI.slice(2, 4).map((item, index) => ({
      phase: "l2_to_l1_translation_practice",
      item,
      practice: true,
      practiceIndex: index + 1,
      audioAccentId: l2ToL1PracticeAccentIds[index],
      talker: pickTestTalker(ACCENT_SETS[l2ToL1PracticeAccentIds[index]], numericId, index),
    }));
    const matchingPracticeBase = [
      {
        item: PRACTICE_STIMULI[0],
        audioItem: PRACTICE_STIMULI[0],
        match: true,
        expected_key: RESPONSE_KEYS.yes,
      },
      {
        item: PRACTICE_STIMULI[1],
        audioItem: PRACTICE_STIMULI[2],
        match: false,
        expected_key: RESPONSE_KEYS.no,
      },
      {
        item: PRACTICE_STIMULI[2],
        audioItem: PRACTICE_STIMULI[2],
        match: true,
        expected_key: RESPONSE_KEYS.yes,
      },
      {
        item: PRACTICE_STIMULI[3],
        audioItem: PRACTICE_STIMULI[0],
        match: false,
        expected_key: RESPONSE_KEYS.no,
      },
    ];
    const matchingPracticeAccentIds = buildBalancedTestAccentIds(matchingPracticeBase.length, numericId, 53);
    const pictureMatchingPracticeTrials = matchingPracticeBase.map((trial, index) => ({
      phase: "picture_matching_practice",
      ...trial,
      practice: true,
      practiceIndex: index + 1,
      visualCondition: "practice",
      audioCondition: "practice",
      audioAccentId: matchingPracticeAccentIds[index],
      talker: pickTestTalker(ACCENT_SETS[matchingPracticeAccentIds[index]], numericId, index),
    }));

    return {
      version: VERSION,
      participantId,
      numericId,
      mode: "full",
      phaseMode,
      counterbalanceCell: counterbalanceCell + 1,
      accent,
      singleList,
      multipleList,
      conditionOrder,
      singleTalker,
      multiTalkers,
      testTalkersByAccent: Object.fromEntries(TEST_ACCENT_IDS.map((id) => [id, ACCENT_SETS[id].testTalkers])),
      l2ToL1AccentCounts: countByValue(l2ToL1Trials.map((trial) => trial.audioAccentId)),
      pictureMatchingAccentCounts: countByValue(matchingTrials.map((trial) => trial.audioAccentId)),
      exposures,
      allWords,
      conditionByWord: Object.fromEntries(conditionByWord),
      learningTrials,
      pictureNamingPracticeTrials,
      l2ToL1Trials,
      l2ToL1PracticeTrials,
      productionTrials,
      pictureMatchingPracticeTrials,
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

  function audioAccentForTrial(assignment, trial) {
    return ACCENT_SETS[trial.audioAccentId] || assignment.accent;
  }

  function trialAudioPath(assignment, trial, item) {
    return audioPath(audioAccentForTrial(assignment, trial), trial.talker, item);
  }

  function collectAudioPaths(assignment) {
    const paths = new Set();
    if (assignment.phaseMode === "learning" || assignment.phaseMode === "full") {
      assignment.learningTrials.forEach((trial) => paths.add(audioPath(assignment.accent, trial.talker, trial.item)));
    }
    if (assignment.phaseMode === "tests" || assignment.phaseMode === "full") {
      assignment.l2ToL1PracticeTrials.forEach((trial) => paths.add(trialAudioPath(assignment, trial, trial.item)));
      assignment.l2ToL1Trials.forEach((trial) => paths.add(trialAudioPath(assignment, trial, trial.item)));
      assignment.pictureMatchingPracticeTrials.forEach((trial) => paths.add(trialAudioPath(assignment, trial, trial.audioItem)));
      assignment.matchingTrials.forEach((trial) => paths.add(trialAudioPath(assignment, trial, trial.audioItem)));
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
    const imageItems = assignment.phaseMode === "tests" || assignment.phaseMode === "full"
      ? assignment.allWords.concat(PRACTICE_STIMULI)
      : assignment.allWords;
    const imageResults = await Promise.all(imageItems.map(preloadImage));
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

  async function playBlob(blob) {
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    const ended = new Promise((resolve, reject) => {
      audio.onended = resolve;
      audio.onerror = () => reject(new Error("録音の再生に失敗しました。"));
    });
    try {
      await audio.play();
      await ended;
    } finally {
      URL.revokeObjectURL(url);
    }
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
      `パート1\n\n音声を聞き、表示された意味と英単語の対応を覚えてください。\n準備ができたらスペースキーを押してください。`
    );
    const total = assignment.learningTrials.length;
    const start = performance.now();
    for (let i = 0; i < total; i += 1) {
      const trial = assignment.learningTrials[i];
      updateProgress("パート1", i + 1, total);
      const visualMode = showVisual(trial.item, assets.imageMap, "");
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
        audio_accent_condition: assignment.accent.id,
        audio_accent_code: sessionCodeForAccent(assignment.accent.id),
        talker: trial.talker,
        audio_file: path,
        visual_mode: visualMode,
        audio_onset_ms: audioOnsetMs.toFixed(1),
      }));
      saveCheckpoint(assignment, rows);
      showFixation();
      await delay(LEARNING_ITI_MS);
      if (interruptRequested) return false;
      if ((i + 1) < total && (i + 1) % BREAK_EVERY_TRIALS === 0) {
        await waitForSpace(`休憩\n\n${i + 1}/${total} 試行が終わりました。\nスペースキーで続行`);
      }
    }
    return true;
  }

  async function replayPracticeRecording(recording) {
    showMessage("録音を再生します。\n音量と聞こえ方を確認してください。");
    await delay(500);
    await playBlob(recording.blob);
    await waitForSpace("録音を確認してください。\n聞こえ方に問題がある場合は担当者に知らせてください。\n問題がなければスペースキーで続行");
  }

  async function runPictureNamingPractice(assignment, assets, rows, recordings) {
    await waitForSpace(
      `${TASK_TITLES.pictureNaming}\n\n練習を行います。\n表示された意味にあう英単語を声に出してください。\n録音を再生して音量を確認します。\n準備ができたらスペースキーを押してください。`
    );
    await ensureMicStream();
    const total = assignment.pictureNamingPracticeTrials.length;
    for (let i = 0; i < total; i += 1) {
      const trial = assignment.pictureNamingPracticeTrials[i];
      updateProgress(`${TASK_TITLES.pictureNaming} 練習`, i + 1, total);
      const visualMode = showVisual(trial.item, assets.imageMap, "練習");
      els.responseHint.textContent = "英単語を声に出してください";
      const recording = await recordWav(PRACTICE_RECORD_MS);
      const fileName = recordingFileName(assignment, "picture_naming", i + 1, trial.item, true);
      recordings.push({ fileName: `practice/${fileName}`, blob: recording.blob });
      rows.push(baseRow(assignment, {
        phase: "picture_naming",
        task_name: TASK_TITLES.pictureNaming,
        practice: 1,
        exclude_from_analysis: 1,
        trial: i + 1,
        word: trial.item.word,
        item_id: trial.item.id,
        expected_response: trial.item.word,
        expected_l1: trial.item.ja,
        visual_mode: visualMode,
        recording_file: `recordings/practice/${fileName}`,
        recording_duration_ms: recording.duration_ms.toFixed(1),
        recording_sample_rate_hz: recording.sample_rate_hz,
      }));
      saveCheckpoint(assignment, rows);
      await replayPracticeRecording(recording);
      showFixation();
      await delay(LEARNING_ITI_MS);
      if (interruptRequested) return false;
    }
    return true;
  }

  async function runPictureNaming(assignment, assets, rows, recordings) {
    await waitForSpace(
      `${TASK_TITLES.pictureNaming}\n\n表示された意味にあう英単語を声に出してください。\n各試行は${(PRODUCTION_RECORD_MS / 1000).toFixed(0)}秒録音されます。\n準備ができたらスペースキーを押してください。`
    );
    await ensureMicStream();
    const total = assignment.productionTrials.length;
    for (let i = 0; i < total; i += 1) {
      const trial = assignment.productionTrials[i];
      updateProgress(TASK_TITLES.pictureNaming, i + 1, total);
      const visualMode = showVisual(trial.item, assets.imageMap, "");
      els.responseHint.textContent = "録音中";
      const recording = await recordWav(PRODUCTION_RECORD_MS);
      const fileName = recordingFileName(assignment, "picture_naming", i + 1, trial.item);
      recordings.push({ fileName: `picture_naming/${fileName}`, blob: recording.blob });
      rows.push(baseRow(assignment, {
        phase: "picture_naming",
        task_name: TASK_TITLES.pictureNaming,
        practice: 0,
        exclude_from_analysis: 0,
        trial: i + 1,
        condition: trial.condition,
        word: trial.item.word,
        item_id: trial.item.id,
        expected_response: trial.item.word,
        expected_l1: trial.item.ja,
        visual_mode: visualMode,
        recording_file: `recordings/picture_naming/${fileName}`,
        recording_duration_ms: recording.duration_ms.toFixed(1),
        recording_sample_rate_hz: recording.sample_rate_hz,
      }));
      saveCheckpoint(assignment, rows);
      showFixation();
      await delay(LEARNING_ITI_MS);
      if (interruptRequested) return false;
    }
    return true;
  }

  async function recordSpokenTranslation(assets, path, durationMs) {
    await ensureMicStream();
    const recordingPromise = recordWav(durationMs);
    await delay(150);
    const audioOnset = performance.now();
    await playAudio(assets.audioMap, path);
    const recording = await recordingPromise;
    return { recording, audioOnset };
  }

  async function runL2ToL1Practice(assignment, assets, rows, recordings) {
    await waitForSpace(
      `${TASK_TITLES.l2ToL1}\n\n練習を行います。\n英単語の音声を聞いたら、できるだけ早く正確に日本語訳を声に出してください。\n録音を再生して音量を確認します。\n準備ができたらスペースキーを押してください。`
    );
    await ensureMicStream();
    const total = assignment.l2ToL1PracticeTrials.length;
    for (let i = 0; i < total; i += 1) {
      const trial = assignment.l2ToL1PracticeTrials[i];
      updateProgress(`${TASK_TITLES.l2ToL1} 練習`, i + 1, total);
      showSoundCue("音声");
      els.responseHint.textContent = "音声を聞いたら日本語訳を声に出してください";
      const audioAccent = audioAccentForTrial(assignment, trial);
      const path = trialAudioPath(assignment, trial, trial.item);
      const trialStart = performance.now();
      const { recording, audioOnset } = await recordSpokenTranslation(assets, path, PRACTICE_RECORD_MS);
      const fileName = recordingFileName(assignment, "l2_to_l1_translation", i + 1, trial.item, true);
      recordings.push({ fileName: `practice/${fileName}`, blob: recording.blob });
      rows.push(baseRow(assignment, {
        phase: "l2_to_l1_translation",
        task_name: TASK_TITLES.l2ToL1,
        practice: 1,
        exclude_from_analysis: 1,
        trial: i + 1,
        word: trial.item.word,
        item_id: trial.item.id,
        expected_response: trial.item.ja,
        expected_l1: trial.item.ja,
        audio_accent_condition: audioAccent.id,
        audio_accent_code: sessionCodeForAccent(audioAccent.id),
        talker: trial.talker,
        audio_file: path,
        audio_onset_ms: (audioOnset - trialStart).toFixed(1),
        recording_file: `recordings/practice/${fileName}`,
        recording_duration_ms: recording.duration_ms.toFixed(1),
        recording_sample_rate_hz: recording.sample_rate_hz,
      }));
      saveCheckpoint(assignment, rows);
      await replayPracticeRecording(recording);
      await waitForSpace(`練習の正答: ${trial.item.ja}\nスペースキーで続行`);
      showFixation();
      await delay(LEARNING_ITI_MS);
      if (interruptRequested) return false;
    }
    return true;
  }

  async function runL2ToL1(assignment, assets, rows, recordings) {
    await waitForSpace(
      `${TASK_TITLES.l2ToL1}\n\n英単語の音声を聞いたら、できるだけ早く正確に日本語訳を声に出してください。\n各試行は${(L2_TRANSLATION_RECORD_MS / 1000).toFixed(0)}秒録音されます。\n準備ができたらスペースキーを押してください。`
    );
    await ensureMicStream();
    const total = assignment.l2ToL1Trials.length;
    for (let i = 0; i < total; i += 1) {
      const trial = assignment.l2ToL1Trials[i];
      updateProgress(TASK_TITLES.l2ToL1, i + 1, total);
      showSoundCue("音声");
      els.responseHint.textContent = "音声を聞いたら日本語訳を声に出してください";
      const audioAccent = audioAccentForTrial(assignment, trial);
      const path = trialAudioPath(assignment, trial, trial.item);
      const trialStart = performance.now();
      const { recording, audioOnset } = await recordSpokenTranslation(assets, path, L2_TRANSLATION_RECORD_MS);
      const fileName = recordingFileName(assignment, "l2_to_l1_translation", i + 1, trial.item);
      recordings.push({ fileName: `l2_to_l1_translation/${fileName}`, blob: recording.blob });
      rows.push(baseRow(assignment, {
        phase: "l2_to_l1_translation",
        task_name: TASK_TITLES.l2ToL1,
        practice: 0,
        exclude_from_analysis: 0,
        trial: i + 1,
        condition: trial.condition,
        word: trial.item.word,
        item_id: trial.item.id,
        expected_response: trial.item.ja,
        expected_l1: trial.item.ja,
        audio_accent_condition: audioAccent.id,
        audio_accent_code: sessionCodeForAccent(audioAccent.id),
        talker: trial.talker,
        audio_file: path,
        audio_onset_ms: (audioOnset - trialStart).toFixed(1),
        recording_file: `recordings/l2_to_l1_translation/${fileName}`,
        recording_duration_ms: recording.duration_ms.toFixed(1),
        recording_sample_rate_hz: recording.sample_rate_hz,
      }));
      saveCheckpoint(assignment, rows);
      showFixation();
      await delay(LEARNING_ITI_MS);
      if (interruptRequested) return false;
    }
    return true;
  }

  async function runPictureMatchingPractice(assignment, assets, rows) {
    await waitForSpace(
      `${TASK_TITLES.pictureMatching}\n\n練習を行います。\n表示された意味と音声が一致するか判断してください。\nF = 不一致、J = 一致\n音声の聞こえ方も確認してください。\n準備ができたらスペースキーを押してください。`
    );
    const total = assignment.pictureMatchingPracticeTrials.length;
    for (let i = 0; i < total; i += 1) {
      const trial = assignment.pictureMatchingPracticeTrials[i];
      updateProgress(`${TASK_TITLES.pictureMatching} 練習`, i + 1, total);
      const visualMode = showVisual(trial.item, assets.imageMap, "練習");
      await delay(VISUAL_TO_AUDIO_MS);
      const audioAccent = audioAccentForTrial(assignment, trial);
      const path = trialAudioPath(assignment, trial, trial.audioItem);
      const onset = performance.now();
      await playAudio(assets.audioMap, path);
      els.responseHint.textContent = "F = 不一致 / J = 一致";
      const response = await waitForKey([RESPONSE_KEYS.no, RESPONSE_KEYS.yes], onset, 8000);
      const correct = response.key === trial.expected_key ? 1 : 0;
      rows.push(baseRow(assignment, {
        phase: "picture_matching",
        task_name: TASK_TITLES.pictureMatching,
        practice: 1,
        exclude_from_analysis: 1,
        trial: i + 1,
        visual_condition: trial.visualCondition,
        audio_condition: trial.audioCondition,
        visual_word: trial.item.word,
        audio_word: trial.audioItem.word,
        audio_accent_condition: audioAccent.id,
        audio_accent_code: sessionCodeForAccent(audioAccent.id),
        match: trial.match,
        expected_key: trial.expected_key,
        response_key: response.key,
        correct,
        rt_ms: response.rt_ms === null ? "" : response.rt_ms.toFixed(1),
        timeout: response.timeout ? 1 : 0,
        talker: trial.talker,
        audio_file: path,
        visual_mode: visualMode,
      }));
      saveCheckpoint(assignment, rows);
      const feedback = correct ? "正解です。" : "不正解です。";
      const answer = trial.match ? "一致" : "不一致";
      await waitForSpace(`${feedback}\n正答: ${answer}\n音声が聞こえにくい場合は担当者に知らせてください。\nスペースキーで続行`);
      showFixation();
      await delay(LEARNING_ITI_MS);
      if (interruptRequested) return false;
    }
    return true;
  }

  async function runPictureMatching(assignment, assets, rows) {
    await waitForSpace(
      `${TASK_TITLES.pictureMatching}\n\n表示された意味と音声が一致するか判断してください。\nF = 不一致、J = 一致\n準備ができたらスペースキーを押してください。`
    );
    const total = assignment.matchingTrials.length;
    for (let i = 0; i < total; i += 1) {
      const trial = assignment.matchingTrials[i];
      updateProgress(TASK_TITLES.pictureMatching, i + 1, total);
      const visualMode = showVisual(trial.item, assets.imageMap, "");
      await delay(VISUAL_TO_AUDIO_MS);
      const audioAccent = audioAccentForTrial(assignment, trial);
      const path = trialAudioPath(assignment, trial, trial.audioItem);
      const onset = performance.now();
      await playAudio(assets.audioMap, path);
      els.responseHint.textContent = "F = 不一致 / J = 一致";
      const response = await waitForKey([RESPONSE_KEYS.no, RESPONSE_KEYS.yes], onset, 6000);
      rows.push(baseRow(assignment, {
        phase: "picture_matching",
        task_name: TASK_TITLES.pictureMatching,
        practice: 0,
        exclude_from_analysis: 0,
        trial: i + 1,
        visual_condition: trial.visualCondition,
        audio_condition: trial.audioCondition,
        visual_word: trial.item.word,
        audio_word: trial.audioItem.word,
        audio_accent_condition: audioAccent.id,
        audio_accent_code: sessionCodeForAccent(audioAccent.id),
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
      saveCheckpoint(assignment, rows);
      showFixation();
      await delay(LEARNING_ITI_MS);
      if (interruptRequested) return false;
    }
    return true;
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
      if (recordings.length) {
        throw new Error("ZIPファイルを作成できません。ネットワーク接続を確認してから再読み込みしてください。");
      }
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
      test_talkers_by_accent: assignment.testTalkersByAccent,
      l2_to_l1_accent_counts: assignment.l2ToL1AccentCounts,
      picture_matching_accent_counts: assignment.pictureMatchingAccentCounts,
      exposures_per_word: assignment.exposures,
      words: assignment.allWords.map((item) => ({ id: item.id, word: item.word, list: item.list, ja: item.ja })),
      practice_words: PRACTICE_STIMULI.map((item) => ({ id: item.id, word: item.word, ja: item.ja })),
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
    if (!enforceChromeGuard()) return;
    const participantId = els.participantId.value.trim();
    if (!participantId) {
      setStatus("参加者IDを入力してください。");
      return;
    }
    const accentId = normalizeAccentId(els.accentCondition.value);
    if (!accentId) {
      setStatus("案内番号を確認してください。");
      return;
    }
    const phaseMode = els.phaseMode.value;
    if (!PHASE_MODES.includes(phaseMode)) {
      setStatus("実施範囲を選択してください。");
      return;
    }
    els.prepareBtn.disabled = true;
    els.startBtn.disabled = true;
    els.downloadBtn.disabled = true;
    setLog("");
    setStatus("準備しています...");
    try {
      const assignment = buildAssignment(participantId, accentId, phaseMode);
      const assets = await preloadAssets(assignment);
      prepared = { assignment, assets };
      els.startBtn.disabled = false;
      setStatus("準備完了。開始できます。");
      if (DEBUG_MODE) {
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
          `test_talkers: ${Object.entries(assignment.testTalkersByAccent).map(([id, talkers]) => `${id}:${talkers.join("/")}`).join(", ")}`,
          `l2_test_accents: ${JSON.stringify(assignment.l2ToL1AccentCounts)}`,
          `matching_test_accents: ${JSON.stringify(assignment.pictureMatchingAccentCounts)}`,
          `learning_trials: ${assignment.learningTrials.length}`,
          `picture_naming_practice_trials: ${assignment.pictureNamingPracticeTrials.length}`,
          `picture_naming_trials: ${assignment.productionTrials.length}`,
          `l2_to_l1_practice_trials: ${assignment.l2ToL1PracticeTrials.length}`,
          `l2_to_l1_trials: ${assignment.l2ToL1Trials.length}`,
          `picture_matching_practice_trials: ${assignment.pictureMatchingPracticeTrials.length}`,
          `picture_matching_trials: ${assignment.matchingTrials.length}`,
          `missing_images: ${assets.missingImages}`,
        ].join("\n"));
      } else {
        setLog("教材の読み込みが完了しました。担当者の合図で開始してください。");
      }
    } catch (error) {
      prepared = null;
      setStatus("準備エラー。担当者に知らせてください。");
      setLog(DEBUG_MODE
        ? (error.stack || String(error))
        : "教材ファイルの読み込みを確認してください。");
    } finally {
      els.prepareBtn.disabled = false;
    }
  }

  function requestInterrupt() {
    if (!activeRun) return;
    interruptRequested = true;
    els.interruptBtn.disabled = true;
    setStatus("現在の試行後に中断します。");
    setLog("現在の試行が終わると中断ファイルを保存します。画面を閉じずにお待ちください。");
  }

  async function finishInterrupted(assignment, rows, recordings) {
    saveCheckpoint(assignment, rows, "interrupted");
    showMessage("中断しました。\nファイルを作成しています。");
    const resultPackage = await buildResultPackage(assignment, rows, recordings);
    if (downloadBlobUrl) URL.revokeObjectURL(downloadBlobUrl);
    downloadBlobUrl = URL.createObjectURL(resultPackage.blob);
    lastDownloadMeta = {
      participantId: assignment.participantId,
      phaseMode: assignment.phaseMode,
      extension: resultPackage.extension,
      label: resultPackage.label,
      status: "partial",
    };
    els.downloadBtn.disabled = false;
    els.prepareBtn.disabled = false;
    if (els.autoDownload.checked) {
      downloadResults();
      setStatus(`中断しました。中断${resultPackage.label}を保存しました。`);
    } else {
      setStatus(`中断しました。中断${resultPackage.label}を保存してください。`);
    }
    setLog(`partial_rows: ${rows.length}\nrecordings: ${recordings.length}\nresult_file_type: ${resultPackage.extension}`);
  }

  async function start() {
    if (!prepared) {
      setStatus("先に準備を実行してください。");
      return;
    }
    els.startBtn.disabled = true;
    els.prepareBtn.disabled = true;
    els.downloadBtn.disabled = true;
    els.interruptBtn.disabled = false;
    document.body.classList.add("running");
    const rows = [];
    const recordings = [];
    const { assignment, assets } = prepared;
    activeRun = { assignment, rows, recordings };
    interruptRequested = false;
    saveCheckpoint(assignment, rows, "started");
    try {
      if (assignment.phaseMode === "learning" || assignment.phaseMode === "full") {
        const completed = await runLearning(assignment, assets, rows);
        if (!completed) {
          await finishInterrupted(assignment, rows, recordings);
          return;
        }
      }
      if (assignment.phaseMode === "tests" || assignment.phaseMode === "full") {
        let completed = await runPictureNamingPractice(assignment, assets, rows, recordings);
        if (!completed) {
          await finishInterrupted(assignment, rows, recordings);
          return;
        }
        completed = await runPictureNaming(assignment, assets, rows, recordings);
        if (!completed) {
          await finishInterrupted(assignment, rows, recordings);
          return;
        }
        completed = await runL2ToL1Practice(assignment, assets, rows, recordings);
        if (!completed) {
          await finishInterrupted(assignment, rows, recordings);
          return;
        }
        completed = await runL2ToL1(assignment, assets, rows, recordings);
        if (!completed) {
          await finishInterrupted(assignment, rows, recordings);
          return;
        }
        completed = await runPictureMatchingPractice(assignment, assets, rows);
        if (!completed) {
          await finishInterrupted(assignment, rows, recordings);
          return;
        }
        completed = await runPictureMatching(assignment, assets, rows);
        if (!completed) {
          await finishInterrupted(assignment, rows, recordings);
          return;
        }
      }
      if (assignment.phaseMode === "learning") {
        showMessage("この課題は終了しました。\nファイルを作成しています。");
      } else {
        showMessage("終了しました。\nファイルを作成しています。");
      }
      const resultPackage = await buildResultPackage(assignment, rows, recordings);
      if (downloadBlobUrl) URL.revokeObjectURL(downloadBlobUrl);
      downloadBlobUrl = URL.createObjectURL(resultPackage.blob);
      lastDownloadMeta = {
        participantId: assignment.participantId,
        phaseMode: assignment.phaseMode,
        extension: resultPackage.extension,
        label: resultPackage.label,
        status: "complete",
      };
      els.downloadBtn.disabled = false;
      els.prepareBtn.disabled = false;
      clearCheckpoint(assignment);
      if (els.autoDownload.checked) {
        downloadResults();
        setStatus(`完了。${resultPackage.label}を保存しました。必要なら再保存できます。`);
      } else {
        setStatus(`完了。${resultPackage.label}を保存してください。`);
      }
      setLog(`rows: ${rows.length}\nrecordings: ${recordings.length}\nresult_file_type: ${resultPackage.extension}`);
    } catch (error) {
      setStatus(`実行エラー: ${error.message}`);
      setLog(error.stack || String(error));
      els.prepareBtn.disabled = false;
    } finally {
      document.body.classList.remove("running");
      els.interruptBtn.disabled = true;
      activeRun = null;
      interruptRequested = false;
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
    const resultKind = lastDownloadMeta?.status === "partial" ? "partial" : "results";
    const a = document.createElement("a");
    a.href = downloadBlobUrl;
    a.download = `${participantId}_${phaseMode}_vocabulary_task_${resultKind}.${extension}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  function applyQueryDefaults() {
    const params = new URLSearchParams(window.location.search);
    const accent = params.get("code") || params.get("group") || params.get("condition") || params.get("accent");
    const phase = params.get("phase");
    const pid = params.get("participant") || params.get("pid");
    const autoDownload = params.get("autodownload");
    const accentId = normalizeAccentId(accent);
    if (accentId) els.accentCondition.value = DISPLAY_CODES[accentId] || accent;
    if (phase && PHASE_MODES.includes(phase)) els.phaseMode.value = phase;
    if (pid) els.participantId.value = pid;
    if (autoDownload !== null) {
      els.autoDownload.checked = !["0", "false", "no", "off"].includes(autoDownload.trim().toLowerCase());
    }
  }

  window.addEventListener("beforeunload", (event) => {
    if (!document.body.classList.contains("running")) return;
    if (activeRun) saveCheckpoint(activeRun.assignment, activeRun.rows, "browser_leave");
    event.preventDefault();
    event.returnValue = "";
  });

  els.prepareBtn.addEventListener("click", prepare);
  els.startBtn.addEventListener("click", start);
  els.downloadBtn.addEventListener("click", downloadResults);
  els.interruptBtn.addEventListener("click", requestInterrupt);
  els.recoveryDownloadBtn.addEventListener("click", downloadCheckpoint);
  els.recoveryClearBtn.addEventListener("click", clearLatestCheckpoint);
  window.addEventListener("storage", updateRecoveryCard);
  document.body.classList.toggle("debug", DEBUG_MODE);
  applyQueryDefaults();
  updateRecoveryCard();
  enforceChromeGuard();
})();

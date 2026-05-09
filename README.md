# Vocabulary Learning Task

This folder is a static browser prototype for reproducing the talker-variability logic of Barcroft & Sommers Experiment 2 with the current Accentedness stimuli. The participant-facing UI intentionally uses neutral labels so the assignment logic is not visible during the task.

The current platform uses a provisional 24-word subset selected from the original 50-word spreadsheet. The source list is stored at:

```text
Vocabulary_Platform/materials/Stimuli_24.xlsx
```

## Design Implemented

- Accent condition: between-subject factor.
  - `japanese` (`J`)
  - `english` (`E`)
  - `chinese` (`C`)
- Variability condition: within-subject factor.
  - `single`: one talker, six repetitions per word.
  - `multiple`: six talkers, one repetition per talker per word.
- Item counterbalancing:
  - The 24 words are split into List 1 and List 2, with 12 words per list.
  - The provisional lists are balanced on total phonemes, total syllables, and original-list source counts.
  - Assignment is counterbalanced by participant ID within each selected accent group using a 24-cell cycle.
  - The 24 cells cross `2 list assignments x 2 presentation orders x 6 single talkers`.
  - Single / Multiple presentation order is counterbalanced.
  - The single talker is rotated across participant cohorts.
  - Within-block word order and test orders are seeded-randomized by participant ID.
- Phases:
  - Learning.
  - Picture Naming Task: meaning/image cue to spoken English response, recorded as WAV.
  - L2-to-L1 Translation Task: English-word audio cue to spoken Japanese translation, recorded as WAV.
  - Picture Matching Task: meaning/image cue plus audio, with `F` = mismatch and `J` = match.
- Test task order:
  - Picture Naming Task.
  - L2-to-L1 Translation Task.
  - Picture Matching Task.
- Practice trials:
  - Picture Naming Task has two recorded practice trials with playback for microphone/volume checking.
  - L2-to-L1 Translation Task has two recorded practice trials with audio playback and recording playback for volume checking.
  - Picture Matching Task has four feedback practice trials with audio playback for volume checking.
  - Recorded practice trials can be repeated with the `R` key after playback; all practice attempts are saved and excluded from analysis.
  - Practice rows are written to the CSV with `practice=1` and `exclude_from_analysis=1`.
- Recording quality checks:
  - WAV recordings include RMS amplitude, peak amplitude, clipping ratio, and a quality flag in the CSV.
  - Recorded practice trials show a volume warning when the level is too low or clipping is detected.
- Test audio policy:
  - Learning audio uses the assigned session accent only: `E`, `J`, or `C`.
  - Test audio uses separate test talker IDs, not the six learning talkers.
  - L2-to-L1 has 24 trials, with 8 English-accent, 8 Japanese-accent, and 8 Chinese-accent test audio trials per participant.
  - Picture matching has 48 trials, with 16 English-accent, 16 Japanese-accent, and 16 Chinese-accent test audio trials per participant.
  - Test accent assignment is seeded by participant ID, so individual trial order varies while the accent counts remain balanced.

The original Experiment 2 used no-, moderate-, and high-variability conditions. This implementation follows the current requested two-level comparison: Single vs Multiple.

The learning phase has 144 trials: 24 words x 6 presentations. Breaks are inserted every 24 learning trials, i.e., after each full Single/Multiple exposure cycle.

## Separate Learning and Test URLs

The app is static and GitHub Pages friendly. Use the same participant ID and session code for both sessions.
The default `index.html` view runs the full task unless a `phase` query parameter is supplied.

```text
Vocabulary_Platform/learning.html?code=E&participant=001
Vocabulary_Platform/tests.html?code=E&participant=001
```

Equivalent query parameters also work on `index.html`:

```text
Vocabulary_Platform/?phase=learning&code=E&participant=001
Vocabulary_Platform/?phase=tests&code=E&participant=001
```

The public session codes are `E`, `J`, and `C`, corresponding to the English, Japanese, and Chinese conditions. The participant UI exposes these as a dropdown rather than free text.

## Interruptions

During a running session, the page warns before browser unload and writes a checkpoint to localStorage after each completed trial. Participants can use the `中断して保存` button to stop after the current trial and download a partial result package. If the browser is closed unexpectedly, the next visit shows the latest checkpoint so the partial CSV can be downloaded or cleared.

Picture Naming and L2-to-L1 Translation recordings are included in the partial ZIP only when the participant uses the in-page interruption button while the tab is still open. If the browser is force-closed during a recording, the localStorage checkpoint preserves trial metadata but cannot preserve the in-memory audio blob.

This is a partial-save workflow, not a true trial-level resume workflow. If a participant must continue later, keep the partial package and start a new assigned session; merge the files during scoring or exclude the interrupted run according to the study protocol.

## Audio Layout

All accent conditions are self-contained under this folder:

```text
Vocabulary_Platform/audio/english/e1/{word}.wav
...
Vocabulary_Platform/audio/english/e6/{word}.wav

Vocabulary_Platform/audio/japanese/j1/{word}.wav
...
Vocabulary_Platform/audio/japanese/j6/{word}.wav

Vocabulary_Platform/audio/chinese/c1/{word}.wav
...
Vocabulary_Platform/audio/chinese/c6/{word}.wav
```

Test-only placeholder talkers are stored alongside the learning talkers:

```text
Vocabulary_Platform/audio/english/e_test/{word}.wav
Vocabulary_Platform/audio/japanese/j_test/{word}.wav
Vocabulary_Platform/audio/chinese/c_test/{word}.wav
```

The app refuses to start when required audio files are missing. This is intentional so missing assets do not silently enter the experiment.

Temporary placeholder audio can be created from the existing English six-voice TTS files:

```sh
cd /Users/ryuya/Library/CloudStorage/Dropbox/Accentedness/Experiment/Vocabulary_Platform
bash scripts/create_placeholder_audio.sh
```

These placeholder files are copied English TTS audio. They are for UI and timing development only. Replace them with the final Japanese-, English-, and Chinese-accent learning stimuli and the final test-only talker stimuli before collecting data.

Use Google Chrome for data collection. The participant page blocks preparation in other browsers so audio playback and WAV recording are handled consistently.

## Image Layout

Picture tasks will use images when present:

```text
Vocabulary_Platform/images/{word}.jpg
```

If an image is missing, the platform displays the Japanese gloss as a placeholder and logs `visual_mode=gloss_placeholder`. This is suitable for development only; add images before collecting final data for picture-based tasks.

## Running Locally

From `Experiment/`:

```sh
python3 -m http.server 8765
```

Then open:

```text
http://127.0.0.1:8765/Vocabulary_Platform/learning.html?code=J&participant=001
http://127.0.0.1:8765/Vocabulary_Platform/tests.html?code=J&participant=001
```

## Output

The platform downloads a ZIP containing:

- `{participant}_results.csv`
- `{participant}_assignment.json`
- `recordings_manifest.csv`
- `recordings/picture_naming/*.wav`
- `recordings/l2_to_l1_translation/*.wav`
- `recordings/practice/*.wav`

By default, the result package is downloaded automatically at the end of each session. The download button remains available for manual re-download. Add `autodownload=0` to the URL to disable automatic download.

The CSV includes participant ID, phase mode, assigned learning accent condition, variability condition, task name, practice/exclusion flags, test audio accent condition where applicable, talker, item, audio path, recording path, recording quality metrics, RT/correctness where applicable, and visual cue mode.

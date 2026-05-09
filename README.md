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
  - L2-to-L1 typed translation.
  - Production recall with WAV recording.
  - Picture matching with `F` = mismatch and `J` = match.

The original Experiment 2 used no-, moderate-, and high-variability conditions. This implementation follows the current requested two-level comparison: Single vs Multiple.

In full mode, the learning phase has 144 trials: 24 words x 6 presentations.

## Separate Learning and Test URLs

The app is static and GitHub Pages friendly. Use the same participant ID and session code for both sessions.

```text
Vocabulary_Platform/learning.html?code=A&participant=001
Vocabulary_Platform/tests.html?code=A&participant=001
```

Equivalent query parameters also work on `index.html`:

```text
Vocabulary_Platform/?phase=learning&code=A&participant=001
Vocabulary_Platform/?phase=tests&code=A&participant=001
```

Use `mode=demo` for a short smoke test and `mode=full` for the full schedule. The neutral public codes are `A`, `B`, and `C`; legacy `accent=J`, `accent=E`, and `accent=C` links still work for researcher-side compatibility but should not be distributed to participants.

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

The app refuses to start when required audio files are missing. This is intentional so missing assets do not silently enter the experiment.

Temporary placeholder audio can be created from the existing English six-voice TTS files:

```sh
cd /Users/ryuya/Library/CloudStorage/Dropbox/Accentedness/Experiment/Vocabulary_Platform
bash scripts/create_placeholder_audio.sh
```

These placeholder files are copied English TTS audio. They are for UI and timing development only. Replace them with the final Japanese-, English-, and Chinese-accent stimuli before collecting data.

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
http://127.0.0.1:8765/Vocabulary_Platform/learning.html?accent=J&mode=demo&participant=001
http://127.0.0.1:8765/Vocabulary_Platform/tests.html?accent=J&mode=demo&participant=001
```

## Output

The platform downloads a ZIP containing:

- `{participant}_results.csv`
- `{participant}_assignment.json`
- `recordings/*.wav` from the production task when the test session includes production

By default, the result package is downloaded automatically at the end of each session. The download button remains available for manual re-download. Add `autodownload=0` to the URL to disable automatic download.

The CSV includes participant ID, phase mode, accent condition, variability condition, talker, item, audio path, response, RT, correctness where applicable, and visual cue mode.

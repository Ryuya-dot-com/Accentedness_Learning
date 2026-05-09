# Accentedness Learning

This repository hosts the learning session for the Accentedness vocabulary experiment on GitHub Pages.
The participant-facing UI uses neutral labels so the assignment logic is not visible during the task.

Public URL:

```text
https://ryuya-dot-com.github.io/Accentedness_Learning/
```

The test sessions are hosted separately:

```text
https://ryuya-dot-com.github.io/Accentedness_Tests/
```

## Participant URL

Use the same participant ID and session code across the learning and test sessions.

```text
https://ryuya-dot-com.github.io/Accentedness_Learning/?code=E&participant=001
```

The visible session codes are:

- `E`: English condition
- `J`: Japanese condition
- `C`: Chinese condition

Use anonymized participant IDs only. Numeric IDs are recommended for transparent counterbalancing; alphanumeric IDs are also accepted and are assigned by a stable hash when they contain no digits.

The page also supports:

```text
https://ryuya-dot-com.github.io/Accentedness_Learning/learning.html?code=E&participant=001
```

The legacy `tests.html` route redirects to the separate test repository.

## Design Implemented

- Accent condition: between-subject factor.
  - `english` (`E`)
  - `japanese` (`J`)
  - `chinese` (`C`)
- Variability condition: within-subject factor.
  - `single`: one talker, six repetitions per word.
  - `multiple`: six talkers, one repetition per talker per word.
- Item counterbalancing:
  - The 24 words are split into List 1 and List 2, with 12 words per list.
  - Assignment is counterbalanced by participant ID within each selected accent group using a 24-cell cycle.
  - The 24 cells cross `2 list assignments x 2 presentation orders x 6 single talkers`.
  - Single / Multiple presentation order is counterbalanced.
  - The single talker is rotated across participant cohorts.
  - Within-block word order is seeded-randomized by participant ID.
- Learning phase:
  - 144 trials total.
  - 24 words x 6 presentations.
  - Breaks occur every 24 learning trials, after each full exposure cycle.

The original Barcroft & Sommers Experiment 2 included no-, moderate-, and high-variability conditions. This implementation follows the current requested two-level comparison: Single vs Multiple.

## Audio Layout

Learning audio is stored by accent condition and talker:

```text
audio/english/e1/{word}.wav
...
audio/english/e6/{word}.wav

audio/japanese/j1/{word}.wav
...
audio/japanese/j6/{word}.wav

audio/chinese/c1/{word}.wav
...
audio/chinese/c6/{word}.wav
```

The app refuses to start when required learning audio files are missing. This is intentional so missing assets do not silently enter the experiment.

Temporary placeholder audio can be created from the existing English six-voice TTS files:

```sh
bash scripts/create_placeholder_audio.sh
```

These placeholder files are for UI and timing development only. Replace them with the final English-, Japanese-, and Chinese-accent learning stimuli before collecting data.

## Interruptions

During a running session, the page warns before browser unload and writes a checkpoint to localStorage after each completed trial. Participants can use the `中断して保存` button to stop after the current trial and download a partial result package.

If the browser is closed unexpectedly, the next visit shows the latest checkpoint so the partial CSV can be downloaded or cleared. This is a partial-save workflow, not a true trial-level resume workflow.

## Browser

Use Google Chrome for data collection. The participant page blocks preparation in other browsers so audio playback is handled consistently.

## Running Locally

From this repository:

```sh
python3 -m http.server 8765
```

Then open:

```text
http://127.0.0.1:8765/?code=J&participant=001
```

## Output

The platform downloads a ZIP containing:

- `{participant}_results.csv`
- `{participant}_assignment.json`
- `recordings_manifest.csv`

The learning session does not record participant audio. By default, the result package is downloaded automatically at the end of the session. The download button remains available for manual re-download. Add `autodownload=0` to the URL to disable automatic download.

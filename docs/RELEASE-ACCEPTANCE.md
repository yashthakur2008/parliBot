# v0.1.0 publication and installation acceptance

Verified 20 November 2026. This report distinguishes actual release/install behavior from unverified live microphone and acoustic behavior.

| Requested outcome / changed output | Concrete observed result |
|---|---|
| Standalone public Git project | [Repository](https://github.com/yashthakur2008/parliBot) contains a clean bootstrap plus reviewed app history, not the surrounding home-directory repository. Explicit source/archive scans found no personal paths or credential markers. |
| Pull requests and code review | [PR1](https://github.com/yashthakur2008/parliBot/pull/1) merged after separate AI-assisted read-only review and CI. Review reproduced and fixed missing-artifact clean-checkout tests and unsafe active-bundle replacement. AI review is not human approval. |
| Hosted CI | [Final release-branch CI](https://github.com/yashthakur2008/parliBot/actions/runs/44709249394) passed on Linux and macOS. Apple Silicon CI builds and tests the archive. Local final suite94/94, explicit packaging8/8. Clean source without dist:93 pass and one expected artifact skip. |
| Issues | [#2 live voice](https://github.com/yashthakur2008/parliBot/issues/2), [#3 model quality](https://github.com/yashthakur2008/parliBot/issues/3), [#4 signing/platforms](https://github.com/yashthakur2008/parliBot/issues/4) have concrete follow-up acceptance criteria. |
| Public landing page | [Live page](https://yashthakur2008.github.io/parliBot/) returned HTTP200 in real Chrome. Desktop1440px and mobile390px had no horizontal overflow or page errors. [Pages deployment](https://github.com/yashthakur2008/parliBot/actions/runs/44709453128) succeeded. |
| Download button | Clicking the live page's Download for macOS link produced `ParliBot-macOS.zip`, 83,676bytes, with SHA256 matching the published release and local build. No placeholder download. |
| Versioned distribution | [v0.1.0](https://github.com/yashthakur2008/parliBot/releases/tag/v0.1.0) includes macOS ZIP, runtime/packaging source ZIP and SHA256SUMS. No Node/Ollama/model weights bundled. Native helper and launcher are arm64, ad-hoc signed, not notarized. |
| Install on Mac | Downloaded the public release, checked SHA256, extracted it and ran its actual installer. Installed at `~/Applications/ParliBot.app`; strict deep code-signature verification passed before and after installation. No preexisting app was overwritten. |
| Installed runtime | Started the server from the installed bundle, not the source checkout. Status listed the installed local model and on-device speech capability. Actual Chrome six-speech workflow passed in107.8seconds through real inference, streaming HTTP, local synthesis callbacks, bounded coaching, export equality/privacy checks and setup reset. Human input was typed and audio muted. |
| GUI launch | Attempted to open the installed app through the desktop-opening tool. The session explicitly suppressed GUI opening, so that restriction was not bypassed. Finder launch and downloaded-quarantine/Gatekeeper interaction remain unverified. The installed app is ready for the user to open. |

## Artifact identity

```
d8237efa60eb04b4494704d29015e69c071ab27f8ecdefd309773aae0cc84a55  ParliBot-macOS.zip
fb0fa0a625c6dbe2abdebe6d8d5058be53fc94caf84d4f20449408b8277c6843  ParliBot-source.zip
```

## Honest limitations

No microphone permissions were approved or audio captured. This was an installation on a Mac with Node22 and Ollama already available, not a clean-machine prerequisite installation. Native binaries target macOS13+/Apple Silicon, but OS-version coverage and Intel support are not established. CLI download does not reproduce browser quarantine behavior, even though a separate browser download checksum was verified. No security controls or quarantine attributes were removed.

The real small-model run included prefatory speech text and repetitive case-review focus selection. Passing the workflow does not establish debate strength. Coaching remains a question/drill scaffold, not a personalized ballot or acoustic assessment. Those limitations remain tracked rather than being inferred away from test counts.

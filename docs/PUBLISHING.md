# Publication design and execution plan

Approved scope: a standalone public GitHub repository, reviewable PRs, CI, tracked limitations, a GitHub Pages landing page and a versioned macOS ZIP with a launcher. The local application remains local; Pages serves static download information only.

1. Export only application sources, tests and public instructions into a new repository. Exclude the surrounding home-directory Git history, personal work logs, model weights and generated recordings. Scan the allowlist before pushing.
2. Publish the initial application, packaging, site and CI in a feature PR. Run Node tests on Linux/macOS and compile the native helper without requesting microphone access. Obtain a separate AI code review, record its provenance and resolve blockers before merge.
3. Package a macOS app launcher and installer with an explicit file allowlist and checksums. Require installed Node22+ and Ollama. Do not silently download models or modify privacy/security controls.
4. Publish known voice, model-quality and distribution limitations as GitHub issues. Publish the release ZIP and checksums, deploy Pages, then fetch the actual public download and verify its checksum and contents.
5. Install the downloaded artifact in the user's Applications folder with safe handling of existing installations. Launch it and verify the loopback public endpoint and browser UI. Never grant microphone permissions automatically.

Acceptance evidence: clean scoped Git history, passing CI, reviewed PR links, public issue links, live Pages HTTP response, downloadable release checksum, successful installed app launch and known limitations reported separately.

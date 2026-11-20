# Contributing

Use a feature branch and pull request. Run `npm test`; document real public-interface checks separately from mocks. Keep inference on loopback, native recognition on-device and browser vendor recognition explicitly opt-in. Do not bundle model weights, credentials, personal paths or debate recordings.

Voice changes need user-consented live microphone testing before claiming end-to-end voice acceptance. Do not automate OS privacy approval. Packaging changes must be tested after extracting the release ZIP outside the source directory. Website downloads must point to the published release asset, never a nonexistent installer.

Review should identify concrete findings and tests. AI-authored review must be labeled as such; it is not independent human approval. Maintainers may merge after checks and review, recording limitations in issues.

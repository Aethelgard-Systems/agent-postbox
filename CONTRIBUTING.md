# Contributing

Thanks for considering a contribution. countersign stays deliberately small; please open an issue to discuss new features before writing code. Bug fixes, tests and documentation improvements are always welcome.

## Ground rules

- No new runtime dependencies.
- Every write path must keep the receipt → perform → read-back order and come with a test.
- New GitHub endpoints are added to the allowlist in `src/github.js` explicitly and justified in the pull request.
- Tests use synthetic data only. Never commit real tokens, names or repository data.
- Run `npm test` before opening a pull request.

## Contributions and Developer Certificate of Origin

Contributions are welcome.

Unless explicitly stated otherwise, contributions submitted to this project are provided under the Apache License 2.0.

This project uses the [Developer Certificate of Origin (DCO) 1.1](https://developercertificate.org/).

By adding a `Signed-off-by` line to a commit, you certify that you have the right to submit the contribution under the project's license.

Please sign off your commits using:

```bash
git commit -s
```

This creates a line similar to:

```text
Signed-off-by: Jane Doe <jane@example.com>
```

# @funeste38/qflush-runner

`qflush-runner` is the stripped-down launcher variant of `qflush`.

It is intended for CI, smoke tests and lighter environments where you want the `qflush` command surface without booting the full supervision stack or heavier local integrations.

## Install

```bash
npm install @funeste38/qflush-runner
```

## What it does

- exposes the `qflush-runner` binary
- depends on `@funeste38/qflush`
- keeps the runtime footprint smaller for automation contexts

## Typical use cases

- CI pipelines
- smoke tests
- reduced containers
- scripted validation of QFLUSH flows

## Notes

If you want the full daemon and orchestration experience, install `@funeste38/qflush` directly.

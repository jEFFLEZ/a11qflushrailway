#!/bin/bash
set -euo pipefail

echo "[qflush] installing dependencies"
npm ci

echo "[qflush] building daemon"
npm run railway:build

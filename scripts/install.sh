#!/bin/sh
set -e
cd /workspace/apebid
export NPM_CONFIG_AUDIT=false
export NPM_CONFIG_FUND=false
export NPM_CONFIG_ENGINE_STRICT=false
export NPM_CONFIG_MAXSOCKETS=4
/usr/bin/npm install --legacy-peer-deps --no-audit --no-fund

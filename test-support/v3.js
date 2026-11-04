import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const cwd = new URL('../', import.meta.url);
export const V3_SHA = 'ccd19db7c1cf14d2a5df21f38769c73dd96f27b2';
assert.equal(execFileSync('git', ['rev-parse', 'v3^{}'], { cwd, encoding: 'utf8' }).trim(), V3_SHA);
const source = execFileSync('git', ['show', 'v3:src/app.js'], { cwd });
export const { createApp: createV3 } = await import(`data:text/javascript;base64,${source.toString('base64')}`);

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

// Historical phase tests must keep exercising actual released v2 code.
const cwd = new URL('../', import.meta.url);
export const V2_SHA = 'dadb816bac9dad5ffcbf098d130d387bbbdd338c';
assert.equal(execFileSync('git', ['rev-parse', 'v2^{}'], { cwd, encoding: 'utf8' }).trim(), V2_SHA);
const source = execFileSync('git', ['show', 'v2:src/app.js'], { cwd });
export const { createApp: createV2 } = await import(`data:text/javascript;base64,${source.toString('base64')}`);

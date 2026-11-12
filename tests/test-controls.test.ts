import test from 'node:test';
import assert from 'node:assert/strict';
import { testControlsEnabled } from '../src/server/test-controls';

function withEnv(values: Record<string, string | undefined>, run: () => void) {
  const saved = Object.fromEntries(Object.keys(values).map((k) => [k, process.env[k]]));
  try {
    for (const [k, v] of Object.entries(values)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    run();
  } finally {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
}

test('clock controls are off unless the test switch is set', () => {
  withEnv({ HALQA_TEST_CONTROLS: undefined, NODE_ENV: 'test' }, () => assert.equal(testControlsEnabled(), false));
  withEnv({ HALQA_TEST_CONTROLS: '0', NODE_ENV: 'test' }, () => assert.equal(testControlsEnabled(), false));
});

test('the test switch turns clock controls on outside production', () => {
  withEnv({ HALQA_TEST_CONTROLS: '1', NODE_ENV: 'test' }, () => assert.equal(testControlsEnabled(), true));
});

test('the old switch name no longer does anything', () => {
  withEnv({ HALQA_TEST_CONTROLS: undefined, ['HALQA_' + 'DEMO_CONTROLS']: '1', NODE_ENV: 'test' }, () => assert.equal(testControlsEnabled(), false));
});

test('clock controls are refused when NODE_ENV is production', () => {
  withEnv({ HALQA_TEST_CONTROLS: '1', NODE_ENV: 'production' }, () => assert.equal(testControlsEnabled(), false));
});

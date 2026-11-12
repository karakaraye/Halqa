/**
 * Read an environment variable when the server runs, not when it is built.
 * The build replaces the literal `process.env.NODE_ENV` with "production",
 * which would make the refusal below impossible to switch off for tests.
 */
const runtimeEnv = (name: string) => process.env[name];

/**
 * Clock controls exist only so automated tests can move time forward.
 * HALQA_TEST_CONTROLS=1 enables them, and they are always refused when
 * NODE_ENV is 'production'. The browser tests start the production build with
 * NODE_ENV=test.
 */
export const testControlsEnabled = () =>
  runtimeEnv('HALQA_TEST_CONTROLS') === '1' && runtimeEnv('NODE_ENV') !== 'production';

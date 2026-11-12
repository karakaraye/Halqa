import {defineConfig} from '@playwright/test';
import {resolve} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
process.env.HALQA_DB_PATH=process.env.HALQA_E2E_DB ||= resolve('data',`browser-${randomUUID()}`,'halqa.sqlite');
process.env.HALQA_E2E_PASSWORD ||= 'Browser-test-'+randomUUID();
process.env.HALQA_TEST_CONTROLS='1';
// Keys for the two server-to-server routes. The server holds only their SHA-256; the tests hold the keys.
process.env.HALQA_E2E_INTAKE_KEY ||= 'intake-'+randomUUID();
process.env.HALQA_E2E_DELIVERY_KEY ||= 'delivery-'+randomUUID();
// The port can be changed with HALQA_E2E_PORT when 3001 is taken by something else.
const port=process.env.HALQA_E2E_PORT||'3001';
const sha256=(value:string)=>createHash('sha256').update(value).digest('hex');
// The server refuses clock controls when NODE_ENV is production, so the built app runs with NODE_ENV=test here.
// Each test sends its own X-Forwarded-For address (see helpers.ts), so HALQA_TRUST_PROXY=1 makes every test a separate client for the request limits.
// The message service address points at a closed port: written messages stay queued until the test sends the delivery report.
export default defineConfig({
  testDir:'./e2e',workers:1,fullyParallel:false,timeout:90000,
  globalSetup:'./e2e/setup.ts',reporter:'list',
  use:{baseURL:`http://localhost:${port}`,viewport:{width:1280,height:850},trace:'retain-on-failure',screenshot:'only-on-failure',launchOptions:{channel:'chromium'}},
  webServer:{command:'npm start',url:`http://localhost:${port}`,reuseExistingServer:false,timeout:120000,env:{
    PORT:port,HALQA_DB_PATH:process.env.HALQA_DB_PATH,HALQA_TEST_CONTROLS:'1',NODE_ENV:'test',NEXT_TELEMETRY_DISABLED:'1',
    HALQA_INTAKE_KEY_SHA256:sha256(process.env.HALQA_E2E_INTAKE_KEY),
    HALQA_DELIVERY_KEY_SHA256:sha256(process.env.HALQA_E2E_DELIVERY_KEY),
    HALQA_TRUST_PROXY:'1',HALQA_MESSAGE_WEBHOOK_URL:'http://127.0.0.1:9/messages',HALQA_MESSAGE_WEBHOOK_TOKEN:'browser-test-webhook-token',
  }},
});

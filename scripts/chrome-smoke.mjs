import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

// This fixture never visits an external site or calls an AI provider.
const base = process.env.CHROME_URL ?? 'http://127.0.0.1:9222';
const versionResponse = await fetch(`${base}/json/version`, { signal: AbortSignal.timeout(10_000) });
assert.equal(versionResponse.status, 200);
const version = await versionResponse.json();
assert.match(version.Browser, /151\.0\.7922\.47/);
const endpoint = new URL(version.webSocketDebuggerUrl);
endpoint.host = new URL(base).host;
const socket = new WebSocket(endpoint);
await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('CDP connection timed out')), 10_000);
  socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
  socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('CDP connection failed')); }, { once: true });
});

let nextId = 0;
const pending = new Map();
socket.addEventListener('message', ({ data }) => {
  const message = JSON.parse(data);
  const request = pending.get(message.id);
  if (!request) return;
  pending.delete(message.id);
  clearTimeout(request.timer);
  if (message.error) request.reject(new Error(JSON.stringify(message.error)));
  else request.resolve(message.result);
});
function send(method, params = {}, sessionId) {
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`${method} timed out`));
    }, 10_000);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
}

let targetId;
try {
  ({ targetId } = await send('Target.createTarget', { url: 'about:blank' }));
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  const html = '<!doctype html><title>Fixture</title><h1>Saved page</h1><script>document.title="JavaScript ready";window.fixtureResult=6*7</script>';
  await send('Page.navigate', { url: `data:text/html,${encodeURIComponent(html)}` }, sessionId);
  const evaluated = await send('Runtime.evaluate', {
    expression: 'new Promise((resolve,reject)=>{let n=0;const t=setInterval(()=>{if(window.fixtureResult===42){clearInterval(t);resolve({title:document.title,value:window.fixtureResult})}else if(++n>100){clearInterval(t);reject(new Error("fixture not loaded"))}},20)})',
    awaitPromise: true,
    returnByValue: true,
  }, sessionId);
  assert.equal(evaluated.exceptionDetails, undefined);
  assert.deepEqual(evaluated.result.value, { title: 'JavaScript ready', value: 42 });
  const screenshot = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
  const png = Buffer.from(screenshot.data, 'base64');
  assert.deepEqual(png.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  assert.ok(png.length > 100);
  console.log(JSON.stringify({ browser: version.Browser, javascript: 'passed', screenshotBytes: png.length, screenshotSha256: createHash('sha256').update(png).digest('hex') }));
} finally {
  if (targetId) await send('Target.closeTarget', { targetId });
  socket.close();
  for (const request of pending.values()) clearTimeout(request.timer);
}

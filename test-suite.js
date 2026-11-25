'use strict';

const assert = require('assert');
const http = require('http');
const { server } = require('./server');

function requestJson(port, method, pathUrl, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: pathUrl,
        method,
        headers: payload
          ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
          : {},
      },
      (res) => {
        let raw = '';
        res.on('data', (c) => (raw += c));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, data: JSON.parse(raw) });
          } catch (e) {
            reject(new Error(`Invalid JSON (${res.statusCode}): ${raw}`));
          }
        });
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function runTests() {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  console.log(`Test server listening on 127.0.0.1:${port}`);

  try {
    // 1. Health endpoint
    const health = await requestJson(port, 'GET', '/api/health');
    assert.strictEqual(health.status, 200);
    assert.strictEqual(health.data.status, 'ONLINE');
    assert.ok(health.data.tools.gpp && health.data.tools.gpp !== 'MISSING', 'g++ must be available');
    assert.ok(health.data.tools.gdb && health.data.tools.gdb !== 'MISSING', 'gdb must be available');
    assert.ok(health.data.tools.objdump && health.data.tools.objdump !== 'MISSING', 'objdump must be available');
    console.log('[PASS] /api/health');

    // 2. Compile & Run with stdin
    const compileCode = `#include <iostream>
int main() {
    int x = 0, y = 0;
    std::cin >> x >> y;
    int* p = new int(x + y);
    std::cout << "SUM=" << *p << std::endl;
    delete p;
    return 0;
}`;
    const runRes = await requestJson(port, 'POST', '/api/compile-run', {
      code: compileCode,
      std: 'c++20',
      opt: '-O0',
      stdin: '15 27',
    });
    assert.strictEqual(runRes.status, 200);
    assert.strictEqual(runRes.data.ok, true);
    assert.ok(runRes.data.stdout.includes('SUM=42'), `Expected SUM=42, got: ${runRes.data.stdout}`);
    assert.ok(runRes.data.disassembly.length > 0, 'Expected disassembly blocks');
    assert.ok(runRes.data.sections.text > 0, 'Expected .text section size');
    assert.strictEqual(runRes.data.staticAnalysis.newCount, 1);
    assert.strictEqual(runRes.data.staticAnalysis.deleteCount, 1);
    console.log('[PASS] /api/compile-run');

    // 3. Interactive Live Debugger (pointers & memory inspection)
    const dbgCode = `#include <iostream>
struct Node { int val; Node* next; };
int main() {
    int a = 42;
    int* p = &a;
    Node* head = new Node{99, nullptr};
    std::cout << *p << " " << head->val << std::endl;
    delete head;
    return 0;
}`;
    const dbgStart = await requestJson(port, 'POST', '/api/debug/start', {
      code: dbgCode,
      std: 'c++20',
      watches: ['*p', 'head->val'],
    });
    assert.strictEqual(dbgStart.status, 200);
    assert.strictEqual(dbgStart.data.ok, true);
    const sid = dbgStart.data.state.sessionId;
    assert.ok(sid, 'Expected sessionId');

    // Step 3 lines forward (past a, p, head initialization)
    let st = dbgStart.data.state;
    for (let i = 0; i < 3; i++) {
      const stepRes = await requestJson(port, 'POST', '/api/debug/action', {
        sessionId: sid,
        action: 'next',
        watches: ['*p', 'head->val'],
      });
      assert.strictEqual(stepRes.data.ok, true);
      st = stepRes.data.state;
    }

    const varA = st.variables.find((v) => v.name === 'a');
    const varP = st.variables.find((v) => v.name === 'p');
    const varHead = st.variables.find((v) => v.name === 'head');
    assert.ok(varA && varA.value === '42', `Expected a=42, got ${JSON.stringify(varA)}`);
    assert.ok(varP && varP.pointsToVar === 'a', `Expected p to point to a, got ${JSON.stringify(varP)}`);
    assert.strictEqual(varP.derefValue, '42');
    assert.ok(varHead && !varHead.isNull, 'Expected head non-null');
    assert.ok(st.heapNodes.length >= 1, 'Expected heapNode for head');
    assert.ok(st.memoryDump && st.memoryDump.rows.length > 0, 'Expected hex memory dump rows');

    const evalRes = await requestJson(port, 'POST', '/api/debug/action', {
      sessionId: sid,
      action: 'eval',
      expression: '*p + head->val',
    });
    assert.strictEqual(evalRes.data.eval.ok, true);
    assert.strictEqual(evalRes.data.eval.value, '141');

    const memRes = await requestJson(port, 'POST', '/api/debug/action', {
      sessionId: sid,
      action: 'memory',
      address: '&a',
      length: 16,
    });
    assert.strictEqual(memRes.data.memoryDump.ok, true);
    assert.strictEqual(memRes.data.memoryDump.rows[0].bytes[0], '2A'); // 42 == 0x2A in little-endian

    await requestJson(port, 'POST', '/api/debug/action', { sessionId: sid, action: 'stop' });
    console.log('[PASS] /api/debug/start & /api/debug/action (pointers, heap, eval, memory)');

    // 4. Time-Travel Trace
    const traceRes = await requestJson(port, 'POST', '/api/debug/trace', {
      code: dbgCode,
      std: 'c++20',
      maxSteps: 20,
    });
    assert.strictEqual(traceRes.status, 200);
    assert.strictEqual(traceRes.data.ok, true);
    assert.ok(traceRes.data.steps.length >= 4, `Expected >=4 trace steps, got ${traceRes.data.steps.length}`);
    const lastStep = traceRes.data.steps[traceRes.data.steps.length - 1];
    assert.ok(lastStep.stdout.includes('42 99'), `Expected stdout in trace, got ${lastStep.stdout}`);
    console.log('[PASS] /api/debug/trace');

    // 5. Interactive Streaming Run (cin waits for user input)
    const interactiveCode = `#include <iostream>
using namespace std;
int main() {
    long long a = 0, b = 0;
    cout << "Nhap hai so a va b: ";
    cin >> a >> b;
    cout << "Tong = " << a + b << endl;
    return 0;
}`;
    const startRun = await requestJson(port, 'POST', '/api/run/start', {
      code: interactiveCode,
      std: 'c++20',
      opt: '-O0',
    });
    assert.strictEqual(startRun.status, 200);
    assert.strictEqual(startRun.data.ok, true);
    const runId = startRun.data.runId;
    assert.ok(runId, 'Expected runId');

    const streamOutput = await new Promise((resolve, reject) => {
      let acc = '';
      let sentInput = false;
      const req = http.get(`http://127.0.0.1:${port}/api/run/stream?runId=${runId}`, (res) => {
        res.on('data', async (chunk) => {
          acc += chunk.toString('utf8');
          if (!sentInput && acc.includes('Nhap hai so a va b:')) {
            sentInput = true;
            await requestJson(port, 'POST', '/api/run/input', { runId, input: '125 375' });
          }
        });
        res.on('end', () => resolve(acc));
      });
      req.on('error', reject);
    });
    assert.ok(streamOutput.includes('Nhap hai so a va b:'), 'Expected prompt before stdin');
    assert.ok(streamOutput.includes('Tong = 500'), `Expected Tong = 500, got: ${streamOutput}`);
    console.log('[PASS] /api/run/start + /api/run/stream + /api/run/input (interactive cin)');

    // 6. Security: env isolation & security headers
    process.env.CRT_SECRET_TEST = 'SUPER_SECRET_123';
    const secCode = `#include <iostream>
#include <cstdlib>
int main() {
    const char* v = std::getenv("CRT_SECRET_TEST");
    std::cout << (v ? v : "ISOLATED") << std::endl;
    return 0;
}`;
    const secRes = await requestJson(port, 'POST', '/api/compile-run', { code: secCode });
    assert.strictEqual(secRes.status, 200);
    assert.ok(secRes.data.stdout.includes('ISOLATED'), `Expected ISOLATED env, got: ${secRes.data.stdout}`);
    console.log('[PASS] Security: child process env isolation');

    console.log('ALL BACKEND TESTS PASSED!');
  } finally {
    server.close();
  }
}

runTests().catch((err) => {
  console.error('TEST FAILED:', err);
  process.exit(1);
});

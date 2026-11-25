(() => {
  'use strict';

  const PRESETS = {
    pointers: {
      stdin: '',
      args: '',
      watches: ['*p', 'np->val', 'arr[1]'],
      code: `#include <iostream>

struct Node {
    int val;
    Node* next;
};

void boostValue(int* ptr, int delta) {
    *ptr = *ptr + delta;
}

int main() {
    int score = 42;
    int* p = &score;
    int arr[3] = {10, 20, 30};

    Node n2{200, nullptr};
    Node n1{100, &n2};
    Node* np = &n1;

    boostValue(p, 8);
    arr[1] = *p + np->next->val;

    std::cout << "score=" << score << " arr[1]=" << arr[1] << "\\n";
    return 0;
}
`,
    },
    linkedlist: {
      stdin: '',
      args: '',
      watches: ['head->val', 'head->next->val'],
      code: `#include <iostream>

struct Node {
    int val;
    Node* next;
};

int main() {
    Node* head = new Node{11, nullptr};
    Node* second = new Node{22, nullptr};
    Node* third = new Node{33, nullptr};

    head->next = second;
    second->next = third;

    int sum = 0;
    Node* cur = head;
    while (cur != nullptr) {
        sum += cur->val;
        cur = cur->next;
    }

    std::cout << "LinkedList Sum = " << sum << "\\n";

    delete third;
    delete second;
    delete head;
    return 0;
}
`,
    },
    recursion: {
      stdin: '5',
      args: '',
      watches: ['n', 'res'],
      code: `#include <iostream>

int factorial(int n) {
    if (n <= 1) return 1;
    int sub = factorial(n - 1);
    int res = n * sub;
    return res;
}

int main() {
    int n = 4;
    if (std::cin >> n) {
        if (n > 8) n = 8;
    }
    int ans = factorial(n);
    std::cout << "factorial(" << n << ") = " << ans << "\\n";
    return 0;
}
`,
    },
    sorting: {
      stdin: '',
      args: '',
      watches: ['data[i]', 'data[j]'],
      code: `#include <iostream>

int main() {
    int data[5] = {38, 12, 47, 5, 29};
    int n = 5;

    for (int i = 0; i < n - 1; ++i) {
        for (int j = 0; j < n - 1 - i; ++j) {
            if (data[j] > data[j + 1]) {
                int tmp = data[j];
                data[j] = data[j + 1];
                data[j + 1] = tmp;
            }
        }
    }

    std::cout << "Sorted:";
    for (int k = 0; k < n; ++k) {
        std::cout << " " << data[k];
    }
    std::cout << "\\n";
    return 0;
}
`,
    },
    segfault: {
      stdin: '',
      args: '',
      watches: ['ptr', 'safePtr'],
      code: `#include <iostream>

int main() {
    int x = 77;
    int* safePtr = &x;
    int* ptr = nullptr;

    std::cout << "Safe value: " << *safePtr << "\\n";
    // Intentional null dereference for Crash Detective demo
    int crash = *ptr;
    std::cout << crash << "\\n";
    return 0;
}
`,
    },
  };

  // DOM References
  const codeEditor = document.getElementById('codeEditor');
  const codeHighlight = document.getElementById('codeHighlight');
  const editorGutter = document.getElementById('editorGutter');
  const editorCursorInfo = document.getElementById('editorCursorInfo');
  const presetSelect = document.getElementById('presetSelect');
  const stdSelect = document.getElementById('stdSelect');
  const optSelect = document.getElementById('optSelect');
  const stdinInput = document.getElementById('stdinInput');
  const argsInput = document.getElementById('argsInput');

  const btnRun = document.getElementById('btnRun');
  const btnDebug = document.getElementById('btnDebug');
  const btnTrace = document.getElementById('btnTrace');
  const btnFx = document.getElementById('btnFx');
  const btnSound = document.getElementById('btnSound');

  const btnStepOver = document.getElementById('btnStepOver');
  const btnStepInto = document.getElementById('btnStepInto');
  const btnStepOut = document.getElementById('btnStepOut');
  const btnContinue = document.getElementById('btnContinue');
  const btnStopDebug = document.getElementById('btnStopDebug');

  const btnTtPrev = document.getElementById('btnTtPrev');
  const btnTtPlay = document.getElementById('btnTtPlay');
  const btnTtNext = document.getElementById('btnTtNext');
  const ttSlider = document.getElementById('ttSlider');
  const ttLabel = document.getElementById('ttLabel');

  const terminalOutput = document.getElementById('terminalOutput');
  const interactiveStdinBar = document.getElementById('interactiveStdinBar');
  const liveStdinInput = document.getElementById('liveStdinInput');
  const btnSendStdin = document.getElementById('btnSendStdin');
  const btnSendEof = document.getElementById('btnSendEof');
  const btnStopRun = document.getElementById('btnStopRun');
  const varsTableBody = document.getElementById('varsTableBody');
  const watchesList = document.getElementById('watchesList');
  const watchInput = document.getElementById('watchInput');
  const btnAddWatch = document.getElementById('btnAddWatch');
  const evalInput = document.getElementById('evalInput');
  const btnEvalExpr = document.getElementById('btnEvalExpr');
  const evalResultBanner = document.getElementById('evalResultBanner');

  const memAddrInput = document.getElementById('memAddrInput');
  const btnReadMem = document.getElementById('btnReadMem');
  const memRangeLabel = document.getElementById('memRangeLabel');
  const hexDumpBox = document.getElementById('hexDumpBox');
  const disasmBox = document.getElementById('disasmBox');
  const callStackBox = document.getElementById('callStackBox');
  const registersBox = document.getElementById('registersBox');
  const staticSafetyBox = document.getElementById('staticSafetyBox');

  const topologySvg = document.getElementById('topologySvg');
  const topologyEmpty = document.getElementById('topologyEmpty');
  const topologySummary = document.getElementById('topologySummary');
  const debugStatusBadge = document.getElementById('debugStatusBadge');
  const toolchainInfo = document.getElementById('toolchainInfo');
  const healthLedText = document.getElementById('healthLedText');

  const dataUsageSvg = document.getElementById('dataUsageSvg');
  const systemPieSvg = document.getElementById('systemPieSvg');
  const activitySvg = document.getElementById('activitySvg');
  const metricCompile = document.getElementById('metricCompile');
  const metricRam = document.getElementById('metricRam');
  const metricBin = document.getElementById('metricBin');
  const metricStack = document.getElementById('metricStack');
  const metricPtrs = document.getElementById('metricPtrs');
  const sysStatusBadge = document.getElementById('sysStatusBadge');

  // App State
  let breakpoints = new Set();
  let errorLines = new Set();
  let activeLine = null;
  let debugSessionId = null;
  let activeRunId = null;
  let activeRunSource = null;
  let watches = ['*p', 'np->val', 'arr[1]'];
  let traceSteps = [];
  let traceIdx = 0;
  let traceTimer = null;
  let soundEnabled = true;
  let audioCtx = null;
  let lastBinarySections = { text: 12400, data: 1024, rodata: 2048, bss: 512, total: 15984 };
  let activitySeries = [18, 25, 22, 40, 35, 62, 48, 54, 70, 50, 58, 44];

  function beep(freq = 660, dur = 0.04, type = 'square') {
    if (!soundEnabled) return;
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.03, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + dur);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + dur);
    } catch {
      // ignore autoplay blocks
    }
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function highlightCppLine(line) {
    const raw = String(line || '');
    if (/^\s*#/.test(raw)) {
      return `<span class="tok-pp">${escapeHtml(raw)}</span>`;
    }

    const tokenRe = /(\/\/.*$|"(?:\\.|[^"\\])*"|\b(?:0x[0-9a-fA-F]+|\d+(?:\.\d+)?)\b|\b(?:int|char|double|float|long|short|bool|void|auto|struct|class|const|static|size_t|nullptr|true|false)\b|\b(?:if|else|for|while|do|switch|case|break|continue|return|new|delete|sizeof|using|namespace|public|private|template|typename)\b)/gm;

    let out = '';
    let last = 0;
    let m;
    while ((m = tokenRe.exec(raw)) !== null) {
      if (m.index > last) {
        out += escapeHtml(raw.slice(last, m.index));
      }
      const tok = m[0];
      let cls = '';
      if (tok.startsWith('//')) cls = 'tok-com';
      else if (tok.startsWith('"')) cls = 'tok-str';
      else if (/^(?:0x[0-9a-fA-F]+|\d)/.test(tok)) cls = 'tok-num';
      else if (/^(?:int|char|double|float|long|short|bool|void|auto|struct|class|const|static|size_t|nullptr|true|false)$/.test(tok)) cls = 'tok-type';
      else cls = 'tok-kw';
      out += `<span class="${cls}">${escapeHtml(tok)}</span>`;
      last = tokenRe.lastIndex;
    }
    if (last < raw.length) {
      out += escapeHtml(raw.slice(last));
    }
    return out;
  }

  function renderEditor() {
    const text = codeEditor.value;
    const lines = text.split('\n');

    // Render highlighted code lines
    const htmlLines = lines.map((ln, idx) => {
      const lineNo = idx + 1;
      const cls = ['code-line-bg'];
      if (activeLine === lineNo) cls.push('active-exec-line');
      if (errorLines.has(lineNo)) cls.push('error-exec-line');
      return `<span class="${cls.join(' ')}">${highlightCppLine(ln) || ' '}</span>`;
    });
    codeHighlight.innerHTML = htmlLines.join('\n') + '\n';

    // Render gutter
    const gutterHtml = lines
      .map((_, idx) => {
        const lineNo = idx + 1;
        const cls = ['gutter-line'];
        if (breakpoints.has(lineNo)) cls.push('has-bp');
        if (activeLine === lineNo) cls.push('is-active');
        if (errorLines.has(lineNo)) cls.push('has-error');
        const mark = breakpoints.has(lineNo) ? '●' : activeLine === lineNo ? '▶' : ' ';
        return `<div class="${cls.join(' ')}" data-line="${lineNo}"><span class="bp-dot">${mark}</span><span>${lineNo}</span></div>`;
      })
      .join('');
    editorGutter.innerHTML = gutterHtml;
    updateCursorInfo();
  }

  function updateCursorInfo() {
    const pos = codeEditor.selectionStart || 0;
    const before = codeEditor.value.slice(0, pos);
    const lines = before.split('\n');
    const ln = lines.length;
    const col = lines[lines.length - 1].length + 1;
    editorCursorInfo.textContent = `LN ${ln}, COL ${col} | BP: ${breakpoints.size}`;
  }

  codeEditor.addEventListener('scroll', () => {
    codeHighlight.scrollTop = codeEditor.scrollTop;
    codeHighlight.scrollLeft = codeEditor.scrollLeft;
    editorGutter.scrollTop = codeEditor.scrollTop;
  });

  codeEditor.addEventListener('input', () => {
    errorLines.clear();
    renderEditor();
  });

  codeEditor.addEventListener('click', updateCursorInfo);
  codeEditor.addEventListener('keyup', updateCursorInfo);

  codeEditor.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const start = codeEditor.selectionStart;
      const end = codeEditor.selectionEnd;
      codeEditor.value = codeEditor.value.slice(0, start) + '    ' + codeEditor.value.slice(end);
      codeEditor.selectionStart = codeEditor.selectionEnd = start + 4;
      renderEditor();
    } else if (e.ctrlKey && e.key === 'Enter') {
      e.preventDefault();
      compileAndRun();
    }
  });

  editorGutter.addEventListener('click', async (e) => {
    const row = e.target.closest('.gutter-line');
    if (!row) return;
    const lineNo = parseInt(row.dataset.line, 10);
    if (breakpoints.has(lineNo)) breakpoints.delete(lineNo);
    else breakpoints.add(lineNo);
    beep(breakpoints.has(lineNo) ? 880 : 440, 0.03);
    renderEditor();

    if (debugSessionId) {
      await apiPost('/api/debug/action', {
        sessionId: debugSessionId,
        action: 'breakpoints',
        breakpoints: Array.from(breakpoints),
      });
    }
  });

  // Tabs
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      switchTab(btn.dataset.tab);
      beep(540, 0.02);
    });
  });

  function switchTab(tabId) {
    document.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === tabId));
    document.querySelectorAll('.tab-content').forEach((p) => p.classList.toggle('active', p.id === `tab-${tabId}`));
  }

  // API Helper
  async function apiPost(url, payload) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return res.json();
  }

  async function checkHealth() {
    try {
      const res = await fetch('/api/health');
      const data = await res.json();
      if (data.status === 'ONLINE') {
        toolchainInfo.textContent = `${data.tools.gpp} | ${data.tools.gdb}`;
        healthLedText.textContent = `ONLINE // ${data.platform.toUpperCase()} ${data.arch.toUpperCase()}`;
        metricRam.textContent = `${data.ramFreeMb} MB`;
      }
    } catch {
      toolchainInfo.textContent = 'BACKEND OFFLINE';
      healthLedText.textContent = 'DISCONNECTED';
    }
  }

  function setLiveDebugButtons(enabled) {
    btnStepOver.disabled = !enabled;
    btnStepInto.disabled = !enabled;
    btnStepOut.disabled = !enabled;
    btnContinue.disabled = !enabled;
    btnStopDebug.disabled = !enabled;
  }

  function setTimeTravelControls(steps) {
    traceSteps = steps || [];
    const hasSteps = traceSteps.length > 0;
    btnTtPrev.disabled = !hasSteps;
    btnTtPlay.disabled = !hasSteps;
    btnTtNext.disabled = !hasSteps;
    ttSlider.disabled = !hasSteps;
    if (hasSteps) {
      ttSlider.min = 0;
      ttSlider.max = traceSteps.length - 1;
      ttSlider.value = 0;
      traceIdx = 0;
      applyDebugState(traceSteps[0]);
      ttLabel.textContent = `STEP 01/${String(traceSteps.length).padStart(2, '0')}`;
    } else {
      ttLabel.textContent = 'STEP --/--';
    }
  }

  function stopTimeTravelPlay() {
    if (traceTimer) {
      clearInterval(traceTimer);
      traceTimer = null;
    }
    btnTtPlay.textContent = '▶ PLAY';
  }

  function setInteractiveRunState(running) {
    liveStdinInput.disabled = !running;
    btnSendStdin.disabled = !running;
    btnSendEof.disabled = !running;
    btnStopRun.disabled = !running;
    interactiveStdinBar.classList.toggle('active', running);
    if (running) {
      switchTab('terminal');
      setTimeout(() => liveStdinInput.focus(), 30);
    }
  }

  function closeActiveRunStream() {
    if (activeRunSource) {
      activeRunSource.close();
      activeRunSource = null;
    }
    activeRunId = null;
    setInteractiveRunState(false);
  }

  async function sendLiveStdin(eof = false) {
    if (!activeRunId) return;
    if (eof) {
      await apiPost('/api/run/input', { runId: activeRunId, eof: true });
      const span = document.createElement('span');
      span.style.color = '#ffcf44';
      span.textContent = '^D (EOF)\n';
      terminalOutput.appendChild(span);
      terminalOutput.scrollTop = terminalOutput.scrollHeight;
      return;
    }
    const text = liveStdinInput.value;
    liveStdinInput.value = '';
    const span = document.createElement('span');
    span.style.color = '#ffcf44';
    span.textContent = text + '\n';
    terminalOutput.appendChild(span);
    terminalOutput.scrollTop = terminalOutput.scrollHeight;
    await apiPost('/api/run/input', { runId: activeRunId, input: text });
    beep(620, 0.02);
  }

  liveStdinInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      sendLiveStdin(false);
    }
  });
  btnSendStdin.addEventListener('click', () => sendLiveStdin(false));
  btnSendEof.addEventListener('click', () => sendLiveStdin(true));
  btnStopRun.addEventListener('click', async () => {
    if (!activeRunId) return;
    await apiPost('/api/run/stop', { runId: activeRunId });
  });

  // COMPILE & RUN (INTERACTIVE STREAMING)
  async function compileAndRun() {
    stopTimeTravelPlay();
    if (activeRunId) {
      await apiPost('/api/run/stop', { runId: activeRunId });
      closeActiveRunStream();
    }

    beep(720, 0.05);
    debugStatusBadge.textContent = 'COMPILING...';
    debugStatusBadge.className = 'status-pill';
    switchTab('terminal');
    terminalOutput.textContent = '> COMPILING MAIN.CPP WITH G++...\n';
    errorLines.clear();
    renderEditor();

    const data = await apiPost('/api/run/start', {
      code: codeEditor.value,
      std: stdSelect.value,
      opt: optSelect.value,
      stdin: stdinInput.value,
      args: argsInput.value,
    });

    if (data.compileTimeMs !== undefined) {
      metricCompile.textContent = `${data.compileTimeMs} ms`;
    }
    if (data.staticAnalysis) renderStaticAnalysis(data.staticAnalysis);
    if (data.sections) {
      lastBinarySections = data.sections;
      metricBin.textContent = `${data.sections.total} B`;
    }
    if (data.disassembly) renderDisassembly(data.disassembly, null);

    if (!data.ok) {
      debugStatusBadge.textContent = 'COMPILE ERROR';
      debugStatusBadge.className = 'status-pill crashed';
      (data.diagnostics || []).forEach((d) => {
        if (d.severity === 'error' || d.severity === 'fatal error') errorLines.add(d.line);
      });
      renderEditor();
      terminalOutput.innerHTML = `<span class="diag-err">[COMPILE FAILED IN ${data.compileTimeMs}ms]\n${escapeHtml(data.compileStderr || data.error)}</span>`;
      beep(220, 0.12);
      renderTelemetryCharts([], [], lastBinarySections);
      return;
    }

    activeRunId = data.runId;
    setInteractiveRunState(true);
    debugStatusBadge.textContent = 'RUNNING (LIVE I/O)';
    debugStatusBadge.className = 'status-pill paused';

    const headerHtml = `<span style="color:#b8ffd0">[COMPILED IN ${data.compileTimeMs}ms | RUNNING INTERACTIVE PROCESS...]\n</span>`;
    const warnHtml = data.compileStderr ? `<span class="diag-warn">${escapeHtml(data.compileStderr)}\n</span>` : '';
    terminalOutput.innerHTML = `${headerHtml}${warnHtml}----------------------------------------\n`;

    const es = new EventSource(`/api/run/stream?runId=${encodeURIComponent(activeRunId)}`);
    activeRunSource = es;

    es.addEventListener('stdout', (ev) => {
      const msg = JSON.parse(ev.data);
      terminalOutput.appendChild(document.createTextNode(msg.text || ''));
      terminalOutput.scrollTop = terminalOutput.scrollHeight;
    });

    es.addEventListener('stderr', (ev) => {
      const msg = JSON.parse(ev.data);
      const span = document.createElement('span');
      span.className = 'diag-err';
      span.textContent = msg.text || '';
      terminalOutput.appendChild(span);
      terminalOutput.scrollTop = terminalOutput.scrollHeight;
    });

    es.addEventListener('exit', (ev) => {
      const info = JSON.parse(ev.data);
      closeActiveRunStream();

      const footer = document.createElement('span');
      footer.style.color = info.timedOut || info.exitCode !== 0 ? '#ff3b5c' : '#b8ffd0';
      footer.textContent = `\n----------------------------------------\n[EXITED ${info.exitCode} IN ${info.runTimeMs}ms${info.timedOut ? ' (IDLE TIMEOUT)' : ''}]`;
      terminalOutput.appendChild(footer);
      terminalOutput.scrollTop = terminalOutput.scrollHeight;

      debugStatusBadge.textContent = info.timedOut ? 'TIMEOUT' : `EXIT ${info.exitCode}`;
      debugStatusBadge.className = info.exitCode === 0 && !info.timedOut ? 'status-pill' : 'status-pill crashed';

      activitySeries.push(Math.min(95, 20 + (info.runTimeMs || 10) % 60));
      if (activitySeries.length > 16) activitySeries.shift();
      renderTelemetryCharts([], [], lastBinarySections);
      beep(info.exitCode === 0 ? 920 : 280, 0.06);
    });

    es.onerror = () => {
      if (activeRunSource === es && es.readyState === EventSource.CLOSED) {
        closeActiveRunStream();
      }
    };
  }

  // LIVE GDB DEBUGGER
  async function startLiveDebug() {
    stopTimeTravelPlay();
    setTimeTravelControls([]);
    if (debugSessionId) {
      await apiPost('/api/debug/action', { sessionId: debugSessionId, action: 'stop' });
      debugSessionId = null;
    }

    beep(760, 0.05);
    debugStatusBadge.textContent = 'STARTING GDB...';
    errorLines.clear();
    renderEditor();

    const data = await apiPost('/api/debug/start', {
      code: codeEditor.value,
      std: stdSelect.value,
      stdin: stdinInput.value,
      args: argsInput.value,
      breakpoints: Array.from(breakpoints),
      watches,
    });

    if (data.compileTimeMs !== undefined) metricCompile.textContent = `${data.compileTimeMs} ms`;
    if (!data.ok) {
      debugStatusBadge.textContent = 'COMPILE ERROR';
      debugStatusBadge.className = 'status-pill crashed';
      (data.diagnostics || []).forEach((d) => {
        if (d.severity === 'error') errorLines.add(d.line);
      });
      renderEditor();
      terminalOutput.innerHTML = `<span class="diag-err">${escapeHtml(data.compileStderr || data.error)}</span>`;
      return;
    }

    debugSessionId = data.state.sessionId;
    setLiveDebugButtons(true);
    if (data.disassembly) renderDisassembly(data.disassembly, data.state.currentAddr);
    applyDebugState(data.state);
  }

  async function doLiveAction(action) {
    if (!debugSessionId) return;
    if (action === 'stop') {
      await apiPost('/api/debug/action', { sessionId: debugSessionId, action: 'stop' });
      debugSessionId = null;
      setLiveDebugButtons(false);
      activeLine = null;
      debugStatusBadge.textContent = 'STOPPED';
      debugStatusBadge.className = 'status-pill';
      renderEditor();
      return;
    }

    const data = await apiPost('/api/debug/action', {
      sessionId: debugSessionId,
      action,
      watches,
    });
    if (!data.ok) {
      debugSessionId = null;
      setLiveDebugButtons(false);
      return;
    }
    applyDebugState(data.state);
    if (data.state.status === 'exited' || data.state.status === 'timeout') {
      debugSessionId = null;
      setLiveDebugButtons(false);
    }
  }

  // TIME-TRAVEL RECORDED TRACE
  async function runTimeTravelTrace() {
    stopTimeTravelPlay();
    if (debugSessionId) {
      await apiPost('/api/debug/action', { sessionId: debugSessionId, action: 'stop' });
      debugSessionId = null;
      setLiveDebugButtons(false);
    }

    beep(840, 0.05);
    debugStatusBadge.textContent = 'RECORDING TRACE...';
    debugStatusBadge.className = 'status-pill paused';
    errorLines.clear();

    const data = await apiPost('/api/debug/trace', {
      code: codeEditor.value,
      std: stdSelect.value,
      stdin: stdinInput.value,
      args: argsInput.value,
      watches,
      maxSteps: 45,
    });

    if (data.compileTimeMs !== undefined) metricCompile.textContent = `${data.compileTimeMs} ms`;
    if (data.staticAnalysis) renderStaticAnalysis(data.staticAnalysis);
    if (!data.ok) {
      debugStatusBadge.textContent = 'COMPILE ERROR';
      debugStatusBadge.className = 'status-pill crashed';
      (data.diagnostics || []).forEach((d) => {
        if (d.severity === 'error') errorLines.add(d.line);
      });
      renderEditor();
      terminalOutput.innerHTML = `<span class="diag-err">${escapeHtml(data.compileStderr || data.error)}</span>`;
      return;
    }

    if (data.sections) {
      lastBinarySections = data.sections;
      metricBin.textContent = `${data.sections.total} B`;
    }
    if (data.disassembly) renderDisassembly(data.disassembly, null);

    setTimeTravelControls(data.steps || []);
    beep(1040, 0.07);
  }

  function applyDebugState(state) {
    if (!state) return;
    activeLine = state.currentLine || null;
    renderEditor();

    // Status pill
    if (state.status === 'crashed') {
      debugStatusBadge.textContent = `SIGNAL: ${state.signalName || 'CRASH'}`;
      debugStatusBadge.className = 'status-pill crashed';
    } else if (state.status === 'exited') {
      debugStatusBadge.textContent = `EXITED (${state.exitCode ?? 0})`;
      debugStatusBadge.className = 'status-pill';
    } else if (state.status === 'timeout') {
      debugStatusBadge.textContent = 'TIMEOUT';
      debugStatusBadge.className = 'status-pill crashed';
    } else {
      debugStatusBadge.textContent = `PAUSED @ LN ${state.currentLine || '?'} (${state.currentFunc || 'main'})`;
      debugStatusBadge.className = 'status-pill paused';
    }

    // Terminal output
    const sigBanner = state.signalName
      ? `<span class="diag-err">[RUNTIME SIGNAL ${state.signalName}: ${escapeHtml(state.signalMeaning || '')}]\n</span>`
      : '';
    terminalOutput.innerHTML = `${sigBanner}${escapeHtml(state.stdout || '<WAITING FOR STDOUT...>')}`;

    // Variables Table
    renderVariablesTable(state.variables || []);
    renderWatches(state.watches || []);
    renderHexDump(state.memoryDump, state.variables || []);
    renderCallStackAndRegs(state.callStack || [], state.registers || {});
    if (state.staticAnalysis) renderStaticAnalysis(state.staticAnalysis);
    if (state.sections) {
      lastBinarySections = state.sections;
      metricBin.textContent = `${state.sections.total} B`;
    }

    // Visual Pointer & Heap Topology
    renderPointerTopology(state.variables || [], state.heapNodes || [], state.callStack || []);

    // Telemetry Charts
    const stackBytes = (state.variables || []).reduce((acc, v) => acc + (v.size || 0), 0);
    const ptrCount = (state.variables || []).filter((v) => v.isPointer).length;
    metricStack.textContent = `${stackBytes} B`;
    metricPtrs.textContent = String(ptrCount);
    sysStatusBadge.textContent = state.status.toUpperCase();

    const depthScore = Math.min(95, 15 + (state.callStack?.length || 1) * 14 + (state.variables || []).filter((v) => v.changed).length * 22 + ptrCount * 8);
    activitySeries.push(depthScore);
    if (activitySeries.length > 16) activitySeries.shift();

    renderTelemetryCharts(state.variables || [], state.heapNodes || [], lastBinarySections);
  }

  function renderVariablesTable(vars) {
    if (!vars.length) {
      varsTableBody.innerHTML = '<tr><td colspan="6" class="dim-cell">NO VARIABLES IN CURRENT FRAME</td></tr>';
      return;
    }
    varsTableBody.innerHTML = vars
      .map((v) => {
        const cls = ['clickable-row'];
        if (v.changed) cls.push('var-changed');
        const targetText = v.isPointer
          ? v.isNull
            ? 'NULL (0x0)'
            : `${v.value}${v.pointsToVar ? ` → [${v.pointsToVar}]` : ' → [HEAP]'}`
          : v.value;
        const derefText = v.isPointer ? (v.isNull ? '<NULL>' : v.derefValue ?? '?') : '-';
        return `<tr class="${cls.join(' ')}" data-addr="${escapeHtml(v.address || '')}">
          <td><strong>${escapeHtml(v.name)}</strong></td>
          <td>${escapeHtml(v.type)}</td>
          <td>${escapeHtml(v.address || '-')}</td>
          <td>${v.size} B</td>
          <td>${escapeHtml(targetText)}</td>
          <td>${escapeHtml(derefText)}</td>
        </tr>`;
      })
      .join('');
  }

  varsTableBody.addEventListener('click', (e) => {
    const row = e.target.closest('tr[data-addr]');
    if (!row || !row.dataset.addr) return;
    inspectMemoryAt(row.dataset.addr);
  });

  function renderWatches(watchResults) {
    const map = new Map((watchResults || []).map((w) => [w.expression, w]));
    watchesList.innerHTML = watches
      .map((expr) => {
        const res = map.get(expr);
        const val = res ? (res.ok ? res.value : `ERR: ${res.value}`) : '--';
        return `<span class="watch-chip">
          <span>${escapeHtml(expr)} = <strong>${escapeHtml(val)}</strong></span>
          <button data-remove-watch="${escapeHtml(expr)}" title="Remove watch">x</button>
        </span>`;
      })
      .join('');
  }

  watchesList.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-remove-watch]');
    if (!btn) return;
    const expr = btn.dataset.removeWatch;
    watches = watches.filter((w) => w !== expr);
    renderWatches([]);
  });

  btnAddWatch.addEventListener('click', async () => {
    const expr = watchInput.value.trim();
    if (!expr) return;
    if (!watches.includes(expr)) watches.push(expr);
    watchInput.value = '';
    if (debugSessionId) {
      const data = await apiPost('/api/debug/action', { sessionId: debugSessionId, action: 'watches', watches });
      if (data.ok) renderWatches(data.watches);
    } else {
      renderWatches([]);
    }
  });

  btnEvalExpr.addEventListener('click', async () => {
    const expr = evalInput.value.trim();
    if (!expr) return;
    if (!debugSessionId) {
      evalResultBanner.textContent = 'Start [⌖ LIVE DEBUG] to evaluate expressions live in GDB.';
      evalResultBanner.classList.remove('hidden');
      return;
    }
    const data = await apiPost('/api/debug/action', { sessionId: debugSessionId, action: 'eval', expression: expr });
    evalResultBanner.classList.remove('hidden');
    if (data.ok && data.eval?.ok) {
      evalResultBanner.textContent = `${expr}  ==>  ${data.eval.value}`;
    } else {
      evalResultBanner.textContent = `EVAL ERROR: ${data.eval?.error || data.error}`;
    }
  });

  async function inspectMemoryAt(addrExpr) {
    memAddrInput.value = addrExpr;
    switchTab('memory');
    if (!debugSessionId) return;
    const data = await apiPost('/api/debug/action', {
      sessionId: debugSessionId,
      action: 'memory',
      address: addrExpr,
      length: 64,
    });
    if (data.ok && data.memoryDump) {
      renderHexDump(data.memoryDump, []);
    }
  }

  btnReadMem.addEventListener('click', () => {
    const expr = memAddrInput.value.trim() || '$sp';
    inspectMemoryAt(expr);
  });

  function renderHexDump(dump, vars) {
    if (!dump || !dump.rows || dump.rows.length === 0) {
      hexDumpBox.innerHTML = '<div class="dim-cell">NO RAM DATA AVAILABLE IN CURRENT FRAME.</div>';
      return;
    }
    memRangeLabel.textContent = `BASE: ${dump.begin || '?'} (64B)`;
    const varRanges = (vars || [])
      .filter((v) => v.address && v.size > 0)
      .map((v) => {
        try {
          const s = BigInt(v.address);
          return { name: v.name, start: s, end: s + BigInt(v.size) };
        } catch {
          return null;
        }
      })
      .filter(Boolean);

    hexDumpBox.innerHTML = dump.rows
      .map((row) => {
        let base = 0n;
        try {
          base = BigInt(row.address);
        } catch {
          base = 0n;
        }
        const byteSpans = row.bytes
          .map((b, i) => {
            const addr = base + BigInt(i);
            const owner = varRanges.find((r) => addr >= r.start && addr < r.end);
            const cls = owner ? 'hex-byte-hi' : '';
            const title = owner ? `title="${escapeHtml(owner.name)}"` : '';
            return `<span class="${cls}" ${title}>${b}</span>`;
          })
          .join(' ');
        return `<div class="hex-row"><span class="hex-addr">${escapeHtml(row.address)}:</span><span class="hex-bytes">${byteSpans}</span><span class="hex-ascii">|${escapeHtml(row.ascii)}|</span></div>`;
      })
      .join('');
  }

  function renderDisassembly(blocks, currentAddr) {
    if (!blocks || !blocks.length) {
      disasmBox.textContent = 'NO USER DISASSEMBLY AVAILABLE.';
      return;
    }
    const normCur = currentAddr ? currentAddr.toLowerCase() : null;
    disasmBox.innerHTML = blocks
      .map((b) => {
        const hdr = `<strong style="color:#b8ffd0">&lt;${escapeHtml(b.name)}&gt; @ ${escapeHtml(b.address)}</strong>`;
        const lines = b.lines
          .map((l) => {
            const isCur = normCur && l.toLowerCase().includes(normCur.replace(/^0x/, ''));
            return isCur ? `<span style="background:rgba(255,207,68,0.2);color:#ffcf44">${escapeHtml(l)}</span>` : escapeHtml(l);
          })
          .join('\n');
        return `${hdr}\n${lines}`;
      })
      .join('\n\n');
  }

  function renderCallStackAndRegs(stack, regs) {
    callStackBox.innerHTML = stack.length
      ? stack
          .map(
            (f) =>
              `<div>#${f.level} <strong>${escapeHtml(f.func)}</strong>(${escapeHtml(f.args)}) <span style="color:#00aa44">@ LN ${f.line || '?'} [${escapeHtml(f.addr)}]</span></div>`
          )
          .join('')
      : 'NO FRAMES';

    const entries = Object.entries(regs || {});
    registersBox.innerHTML = entries.length
      ? entries.map(([k, v]) => `<div class="reg-item"><span>${k}</span><span>${escapeHtml(v)}</span></div>`).join('')
      : 'NO REGISTERS';
  }

  function renderStaticAnalysis(sa) {
    const warnHtml = (sa.warnings || [])
      .map((w) => `<div style="color:${w.includes('No obvious') ? '#33ff77' : '#ffcf44'}">• ${escapeHtml(w)}</div>`)
      .join('');
    staticSafetyBox.innerHTML = `
      <div>LINES: <strong>${sa.lineCount}</strong> | COMPLEXITY: <strong>${sa.cyclomaticComplexity}</strong> | RECURSION: <strong>${sa.hasRecursion ? 'YES' : 'NO'}</strong></div>
      <div>PTR DECLS: <strong>${sa.pointerDeclarations}</strong> | NEW/DELETE: <strong>${sa.newCount}/${sa.deleteCount}</strong> | MALLOC/FREE: <strong>${sa.mallocCount}/${sa.freeCount}</strong></div>
      <div style="margin-top:4px">${warnHtml}</div>
    `;
  }

  // ---------- SVG POINTER & MEMORY TOPOLOGY ----------
  function renderPointerTopology(vars, heapNodes, callStack) {
    if (!vars.length && !heapNodes.length) {
      topologySvg.innerHTML = '';
      topologyEmpty.style.display = 'flex';
      topologySummary.textContent = 'STACK: 0 VARS | HEAP: 0 NODES';
      return;
    }

    topologyEmpty.style.display = 'none';
    topologySummary.textContent = `STACK: ${vars.length} VARS | HEAP: ${heapNodes.length} NODES | FRAMES: ${callStack.length}`;

    const stackBoxW = 240;
    const stackBoxH = 56;
    const gapY = 14;
    const leftX = 24;
    const rightX = 355;
    const totalRows = Math.max(vars.length, heapNodes.length, 1);
    const svgH = Math.max(230, 44 + totalRows * (stackBoxH + gapY));
    const svgW = Math.max(640, heapNodes.length > 0 ? 660 : 620);

    topologySvg.setAttribute('viewBox', `0 0 ${svgW} ${svgH}`);

    const defs = `
      <defs>
        <marker id="ptrArrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 1 L 10 5 L 0 9 z" fill="#33ff77" />
        </marker>
        <marker id="ptrArrowAmber" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 1 L 10 5 L 0 9 z" fill="#ffcf44" />
        </marker>
      </defs>
    `;

    let out = defs;
    out += `<text x="${leftX}" y="20" fill="#33ff77" font-family="VT323, monospace" font-size="18">STACK MEMORY (${escapeHtml(callStack[0]?.func || 'main')})</text>`;
    out += `<text x="${rightX}" y="20" fill="#ffcf44" font-family="VT323, monospace" font-size="18">HEAP &amp; DEREFERENCED TARGETS</text>`;

    const stackCoords = new Map();
    vars.forEach((v, idx) => {
      const y = 32 + idx * (stackBoxH + gapY);
      stackCoords.set(v.name, { x: leftX, y, w: stackBoxW, h: stackBoxH });
      const stroke = v.changed ? '#ffcf44' : v.isPointer ? '#33ff77' : '#00bb48';
      const fill = v.changed ? 'rgba(255,207,68,0.12)' : 'rgba(4,28,11,0.92)';
      const valDisplay = (v.isPointer ? (v.isNull ? 'nullptr (0x0)' : v.targetAddress || v.value) : v.value).slice(0, 26);

      out += `
        <g class="topo-node" data-addr="${escapeHtml(v.address || '')}" style="cursor:pointer">
          <rect x="${leftX}" y="${y}" width="${stackBoxW}" height="${stackBoxH}" rx="4" fill="${fill}" stroke="${stroke}" stroke-width="1.5" />
          <text x="${leftX + 8}" y="${y + 17}" fill="#b8ffd0" font-size="12" font-weight="bold">${escapeHtml(v.name)} <tspan fill="#00aa44" font-weight="normal">(${escapeHtml(v.type)})</tspan></text>
          <text x="${leftX + 8}" y="${y + 34}" fill="${v.changed ? '#ffcf44' : '#33ff77'}" font-size="12">VAL: ${escapeHtml(valDisplay)}</text>
          <text x="${leftX + 8}" y="${y + 49}" fill="#1d8f46" font-size="10">${escapeHtml(v.address || 'reg')} | ${v.size}B</text>
        </g>
      `;
    });

    const heapCoords = new Map();
    heapNodes.forEach((hn, idx) => {
      const y = 32 + idx * (stackBoxH + gapY);
      heapCoords.set(hn.address, { x: rightX, y, w: stackBoxW, h: stackBoxH });
      const valShort = String(hn.value || '').slice(0, 28);
      out += `
        <g class="topo-node" data-addr="${escapeHtml(hn.address)}" style="cursor:pointer">
          <rect x="${rightX}" y="${y}" width="${stackBoxW}" height="${stackBoxH}" rx="4" fill="rgba(25,22,4,0.85)" stroke="#ffcf44" stroke-width="1.5" stroke-dasharray="4 2" />
          <text x="${rightX + 8}" y="${y + 17}" fill="#ffcf44" font-size="12" font-weight="bold">${escapeHtml(hn.label)} <tspan fill="#aa8a2a" font-weight="normal">(${escapeHtml(hn.type)})</tspan></text>
          <text x="${rightX + 8}" y="${y + 34}" fill="#b8ffd0" font-size="11.5">${escapeHtml(valShort)}</text>
          <text x="${rightX + 8}" y="${y + 49}" fill="#aa8a2a" font-size="10">HEAP @ ${escapeHtml(hn.address)} (${hn.size}B)</text>
        </g>
      `;
    });

    // Pointer arrows: stack pointer -> stack variable OR stack pointer -> heap node
    vars.forEach((v) => {
      if (!v.isPointer) return;
      const src = stackCoords.get(v.name);
      if (!src) return;

      if (v.isNull) {
        const ny = src.y + src.h / 2;
        out += `<line x1="${src.x + src.w}" y1="${ny}" x2="${src.x + src.w + 32}" y2="${ny}" stroke="#ff3b5c" stroke-width="1.4" stroke-dasharray="3 2" />`;
        out += `<text x="${src.x + src.w + 36}" y="${ny + 4}" fill="#ff3b5c" font-size="11">NULL</text>`;
        return;
      }

      if (v.pointsToVar && stackCoords.has(v.pointsToVar)) {
        const dst = stackCoords.get(v.pointsToVar);
        const y1 = src.y + src.h / 2;
        const y2 = dst.y + dst.h / 2;
        const bendX = src.x + src.w + 36 + (Math.abs(y1 - y2) % 30);
        out += `<path d="M ${src.x + src.w} ${y1} C ${bendX} ${y1}, ${bendX} ${y2}, ${dst.x + dst.w + 4} ${y2}" fill="none" stroke="#33ff77" stroke-width="1.8" marker-end="url(#ptrArrow)" />`;
      } else if (v.targetAddress && heapCoords.has(v.targetAddress)) {
        const dst = heapCoords.get(v.targetAddress);
        const y1 = src.y + src.h / 2;
        const y2 = dst.y + dst.h / 2;
        const midX = (src.x + src.w + dst.x) / 2;
        out += `<path d="M ${src.x + src.w} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${dst.x - 4} ${y2}" fill="none" stroke="#ffcf44" stroke-width="1.8" marker-end="url(#ptrArrowAmber)" />`;
      }
    });

    // Struct member links (e.g., n1.next -> n2) and heap -> heap links (head -> second -> third)
    vars.forEach((v) => {
      if (!v.memberLinks) return;
      const src = stackCoords.get(v.name);
      if (!src) return;
      v.memberLinks.forEach((lnk) => {
        if (lnk.pointsToVar && stackCoords.has(lnk.pointsToVar)) {
          const dst = stackCoords.get(lnk.pointsToVar);
          const y1 = src.y + src.h - 10;
          const y2 = dst.y + 16;
          const bendX = src.x + src.w + 54;
          out += `<path d="M ${src.x + src.w} ${y1} C ${bendX} ${y1}, ${bendX} ${y2}, ${dst.x + dst.w + 4} ${y2}" fill="none" stroke="#b8ffd0" stroke-width="1.4" stroke-dasharray="4 2" marker-end="url(#ptrArrow)" />`;
        }
      });
    });

    heapNodes.forEach((hn) => {
      const src = heapCoords.get(hn.address);
      if (!src || !hn.links) return;
      hn.links.forEach((lnk) => {
        if (!lnk.isNull && heapCoords.has(lnk.targetAddress)) {
          const dst = heapCoords.get(lnk.targetAddress);
          const y1 = src.y + src.h / 2;
          const y2 = dst.y + dst.h / 2;
          const bendX = src.x + src.w + 34;
          out += `<path d="M ${src.x + src.w} ${y1} C ${bendX} ${y1}, ${bendX} ${y2}, ${dst.x + dst.w + 4} ${y2}" fill="none" stroke="#ffcf44" stroke-width="1.6" marker-end="url(#ptrArrowAmber)" />`;
        }
      });
    });

    topologySvg.innerHTML = out;
  }

  topologySvg.addEventListener('click', (e) => {
    const g = e.target.closest('.topo-node[data-addr]');
    if (!g || !g.dataset.addr) return;
    inspectMemoryAt(g.dataset.addr);
  });

  // ---------- CRT TELEMETRY CHARTS (MATCHING REFERENCE IMAGE) ----------
  function renderTelemetryCharts(vars, heapNodes, sections) {
    renderDataUsageChart(vars, sections);
    renderSystemPieChart(vars, heapNodes, sections);
    renderActivityWaveform();
  }

  function renderDataUsageChart(vars, sections) {
    // 8 bars: either variable sizes or binary sections fallback
    let bars = [];
    if (vars.length > 0) {
      bars = vars.slice(0, 8).map((v) => ({ label: v.name.slice(0, 5), val: Math.max(1, v.size || 4) }));
    } else {
      bars = [
        { label: '.TXT', val: Math.max(10, Math.round((sections.text || 8000) / 1024)) },
        { label: '.RDT', val: Math.max(4, Math.round((sections.rodata || 2000) / 512)) },
        { label: '.DAT', val: Math.max(3, Math.round((sections.data || 1000) / 256)) },
        { label: '.BSS', val: Math.max(2, Math.round((sections.bss || 512) / 256)) },
        { label: 'STK', val: 8 },
        { label: 'HEAP', val: 5 },
        { label: 'PTR', val: 12 },
        { label: 'REG', val: 7 },
      ];
    }
    while (bars.length < 8) {
      bars.push({ label: '-', val: 2 });
    }

    const maxV = Math.max(...bars.map((b) => b.val), 8);
    const W = 320;
    const H = 165;
    const ox = 28;
    const oy = 140;
    const plotW = 276;
    const plotH = 116;

    let svg = `
      <defs>
        <pattern id="barHatch" width="4" height="4" patternUnits="userSpaceOnUse">
          <line x1="0" y1="0" x2="0" y2="4" stroke="#0b4f22" stroke-width="1" />
        </pattern>
      </defs>
    `;

    // Axes & faint grid like reference image
    for (let i = 0; i <= 5; i++) {
      const gy = oy - (plotH * i) / 5;
      svg += `<line x1="${ox}" y1="${gy}" x2="${ox + plotW}" y2="${gy}" stroke="#083617" stroke-width="1" />`;
    }
    for (let i = 0; i <= 8; i++) {
      const gx = ox + (plotW * i) / 8;
      svg += `<line x1="${gx}" y1="${oy - plotH}" x2="${gx}" y2="${oy}" stroke="#083617" stroke-width="1" />`;
    }
    svg += `<polyline points="${ox},${oy - plotH} ${ox},${oy} ${ox + plotW},${oy}" fill="none" stroke="#33ff77" stroke-width="1.5" />`;

    const slotW = plotW / 8;
    const polyPts = [];

    bars.forEach((b, i) => {
      const barW = slotW * 0.62;
      const bx = ox + i * slotW + slotW * 0.19;
      const bh = Math.max(8, (b.val / maxV) * (plotH - 10));
      const by = oy - bh;
      const fill = i % 2 === 0 ? '#1fe066' : '#2bff7a';
      svg += `<rect x="${bx}" y="${by}" width="${barW}" height="${bh}" fill="${fill}" fill-opacity="0.82" stroke="#b8ffd0" stroke-width="0.6" />`;
      svg += `<text x="${bx + barW / 2}" y="${oy + 12}" text-anchor="middle" fill="#00bb48" font-size="9">${escapeHtml(b.label)}</text>`;
      const waveY = Math.max(oy - plotH + 6, by - ((i % 3) * 8 + 4));
      polyPts.push(`${bx + barW / 2},${waveY}`);
    });

    svg += `<polyline points="${polyPts.join(' ')}" fill="none" stroke="#b8ffd0" stroke-width="1.2" />`;
    dataUsageSvg.innerHTML = svg;
  }

  function renderSystemPieChart(vars, heapNodes, sections) {
    const stackVal = Math.max(8, vars.reduce((s, v) => s + (v.size || 4), 0));
    const heapVal = Math.max(4, heapNodes.length * 16);
    const codeVal = Math.max(16, Math.round((sections.text || 4000) / 512));
    const dataVal = Math.max(6, Math.round(((sections.data || 512) + (sections.rodata || 512)) / 256));
    const parts = [
      { val: codeVal, fill: '#28f570' },
      { val: stackVal, fill: 'url(#pieHatch1)' },
      { val: heapVal, fill: 'url(#pieHatch2)' },
      { val: dataVal, fill: '#0c5c28' },
    ];
    const total = parts.reduce((a, b) => a + b.val, 0) || 1;
    const cx = 65;
    const cy = 65;
    const r = 52;

    let svg = `
      <defs>
        <pattern id="pieHatch1" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="5" height="5" fill="#04190a" />
          <line x1="0" y1="0" x2="0" y2="5" stroke="#28f570" stroke-width="2" />
        </pattern>
        <pattern id="pieHatch2" width="4" height="4" patternUnits="userSpaceOnUse">
          <rect width="4" height="4" fill="#04190a" />
          <line x1="0" y1="2" x2="4" y2="2" stroke="#28f570" stroke-width="1.4" />
        </pattern>
      </defs>
    `;

    let angle = -Math.PI / 2;
    parts.forEach((p) => {
      const slice = (p.val / total) * Math.PI * 2;
      const x1 = cx + r * Math.cos(angle);
      const y1 = cy + r * Math.sin(angle);
      const x2 = cx + r * Math.cos(angle + slice);
      const y2 = cy + r * Math.sin(angle + slice);
      const largeArc = slice > Math.PI ? 1 : 0;
      svg += `<path d="M ${cx} ${cy} L ${x1.toFixed(1)} ${y1.toFixed(1)} A ${r} ${r} 0 ${largeArc} 1 ${x2.toFixed(1)} ${y2.toFixed(1)} Z" fill="${p.fill}" stroke="#020a04" stroke-width="1.5" />`;
      angle += slice;
    });

    svg += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#33ff77" stroke-width="1.2" />`;
    systemPieSvg.innerHTML = svg;
  }

  function renderActivityWaveform() {
    const W = 320;
    const H = 135;
    const ox = 18;
    const oy = 115;
    const plotW = 286;
    const plotH = 95;

    let svg = `<polyline points="${ox},${oy - plotH} ${ox},${oy} ${ox + plotW},${oy}" fill="none" stroke="#33ff77" stroke-width="1.5" />`;
    const pts = activitySeries.map((val, idx) => {
      const x = ox + (idx / Math.max(1, activitySeries.length - 1)) * plotW;
      const y = oy - (Math.min(100, Math.max(5, val)) / 100) * (plotH - 8);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });

    svg += `<polyline points="${pts.join(' ')}" fill="none" stroke="#b8ffd0" stroke-width="1.6" />`;
    pts.forEach((pt) => {
      const [px, py] = pt.split(',');
      svg += `<circle cx="${px}" cy="${py}" r="2.1" fill="#33ff77" />`;
    });
    activitySvg.innerHTML = svg;
  }

  // Event Bindings
  btnRun.addEventListener('click', compileAndRun);
  btnDebug.addEventListener('click', startLiveDebug);
  btnTrace.addEventListener('click', runTimeTravelTrace);

  btnStepOver.addEventListener('click', () => doLiveAction('next'));
  btnStepInto.addEventListener('click', () => doLiveAction('step'));
  btnStepOut.addEventListener('click', () => doLiveAction('finish'));
  btnContinue.addEventListener('click', () => doLiveAction('continue'));
  btnStopDebug.addEventListener('click', () => doLiveAction('stop'));

  ttSlider.addEventListener('input', () => {
    stopTimeTravelPlay();
    traceIdx = parseInt(ttSlider.value, 10) || 0;
    if (traceSteps[traceIdx]) {
      applyDebugState(traceSteps[traceIdx]);
      ttLabel.textContent = `STEP ${String(traceIdx + 1).padStart(2, '0')}/${String(traceSteps.length).padStart(2, '0')}`;
      beep(520 + traceIdx * 15, 0.02);
    }
  });

  btnTtPrev.addEventListener('click', () => {
    stopTimeTravelPlay();
    if (traceIdx > 0) {
      traceIdx--;
      ttSlider.value = traceIdx;
      applyDebugState(traceSteps[traceIdx]);
      ttLabel.textContent = `STEP ${String(traceIdx + 1).padStart(2, '0')}/${String(traceSteps.length).padStart(2, '0')}`;
    }
  });

  btnTtNext.addEventListener('click', () => {
    stopTimeTravelPlay();
    if (traceIdx < traceSteps.length - 1) {
      traceIdx++;
      ttSlider.value = traceIdx;
      applyDebugState(traceSteps[traceIdx]);
      ttLabel.textContent = `STEP ${String(traceIdx + 1).padStart(2, '0')}/${String(traceSteps.length).padStart(2, '0')}`;
    }
  });

  btnTtPlay.addEventListener('click', () => {
    if (traceTimer) {
      stopTimeTravelPlay();
      return;
    }
    if (!traceSteps.length) return;
    if (traceIdx >= traceSteps.length - 1) traceIdx = 0;
    btnTtPlay.textContent = '❚❚ PAUSE';
    traceTimer = setInterval(() => {
      if (traceIdx >= traceSteps.length - 1) {
        stopTimeTravelPlay();
        return;
      }
      traceIdx++;
      ttSlider.value = traceIdx;
      applyDebugState(traceSteps[traceIdx]);
      ttLabel.textContent = `STEP ${String(traceIdx + 1).padStart(2, '0')}/${String(traceSteps.length).padStart(2, '0')}`;
    }, 520);
  });

  // Global keyboard shortcuts for debugging
  window.addEventListener('keydown', (e) => {
    if (!debugSessionId) return;
    if (e.key === 'F10') {
      e.preventDefault();
      doLiveAction('next');
    } else if (e.key === 'F11' && !e.shiftKey) {
      e.preventDefault();
      doLiveAction('step');
    } else if (e.key === 'F11' && e.shiftKey) {
      e.preventDefault();
      doLiveAction('finish');
    } else if (e.key === 'F5') {
      e.preventDefault();
      doLiveAction('continue');
    }
  });

  presetSelect.addEventListener('change', () => {
    const p = PRESETS[presetSelect.value];
    if (!p) return;
    stopTimeTravelPlay();
    setTimeTravelControls([]);
    activeLine = null;
    breakpoints.clear();
    errorLines.clear();
    codeEditor.value = p.code;
    stdinInput.value = p.stdin;
    argsInput.value = p.args;
    watches = [...p.watches];
    renderEditor();
    renderWatches([]);
    beep(680, 0.04);
  });

  function toggleFx() {
    document.body.classList.toggle('crt-fx-on');
    const on = document.body.classList.contains('crt-fx-on');
    btnFx.textContent = on ? '[CRT: ON]' : '[CRT: OFF]';
  }

  function toggleSound() {
    soundEnabled = !soundEnabled;
    btnSound.textContent = soundEnabled ? '[SFX: ON]' : '[SFX: OFF]';
  }

  btnFx.addEventListener('click', toggleFx);
  btnSound.addEventListener('click', toggleSound);
  document.getElementById('hwBtnScanline').addEventListener('click', toggleFx);
  document.getElementById('hwBtnSound').addEventListener('click', toggleSound);
  document.getElementById('hwBtnContrast').addEventListener('click', () => {
    document.body.classList.toggle('crt-high-contrast');
  });
  document.getElementById('hwBtnReset').addEventListener('click', () => {
    terminalOutput.textContent = 'CRT-CPP OS READY.';
    beep(420, 0.05);
  });

  // Init
  const initPreset = PRESETS.pointers;
  codeEditor.value = initPreset.code;
  watches = [...initPreset.watches];
  renderEditor();
  renderWatches([]);
  renderTelemetryCharts([], [], lastBinarySections);
  checkHealth();
})();

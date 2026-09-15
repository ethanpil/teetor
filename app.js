const API_URL = 'https://openrouter.ai/api/v1/audio/transcriptions';
const $ = (id) => document.getElementById(id);

const els = {
  apiKey: $('apiKey'), toggleKey: $('toggleKey'), model: $('model'), file: $('audioFile'),
  includeHeader: $('includeHeader'), transcribe: $('transcribe'), spinner: $('spinner'),
  label: $('transcribeLabel'), error: $('error'), results: $('results'),
  statCards: $('statCards'), statDetails: $('statDetails'), transcript: $('transcript'),
  copy: $('copy'), download: $('download'),
};

let header = '';       // Header text for the current file ('' if no result yet)
let baseName = 'transcript';

// Preferences
els.apiKey.value = localStorage.getItem('teetor.apiKey') || '';
els.model.value = localStorage.getItem('teetor.model') || '';
els.includeHeader.checked = localStorage.getItem('teetor.includeHeader') !== 'false';

els.apiKey.addEventListener('input', () => { localStorage.setItem('teetor.apiKey', els.apiKey.value.trim()); updateButton(); });
els.model.addEventListener('input', () => { localStorage.setItem('teetor.model', els.model.value.trim()); updateButton(); });
els.file.addEventListener('change', updateButton);
els.includeHeader.addEventListener('change', () => {
  localStorage.setItem('teetor.includeHeader', els.includeHeader.checked);
  applyHeader();
});
els.toggleKey.addEventListener('click', () => {
  const hidden = els.apiKey.type === 'password';
  els.apiKey.type = hidden ? 'text' : 'password';
  els.toggleKey.textContent = hidden ? 'Hide' : 'Show';
});

function updateButton() {
  els.transcribe.disabled = !(els.apiKey.value.trim() && els.model.value.trim() && els.file.files.length);
}
updateButton();

// Helpers
const pad = (n) => String(n).padStart(2, '0');
const formatDate = (d) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
const formatDuration = (s) => {
  s = Math.round(s);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
};
const formatBytes = (b) => b >= 1048576 ? `${(b / 1048576).toFixed(2)} MB` : `${(b / 1024).toFixed(1)} KB`;
const num = (n) => (n == null ? '—' : Number(n).toLocaleString());

function readBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function setBusy(busy) {
  els.transcribe.disabled = busy;
  els.spinner.classList.toggle('d-none', !busy);
  if (!busy) els.label.textContent = 'Transcribe';
}

function showError(msg) {
  els.error.textContent = msg;
  els.error.classList.toggle('d-none', !msg);
}

// Adds or removes the header at the top of the transcript text
function applyHeader() {
  if (!header) return;
  const text = els.transcript.value;
  if (els.includeHeader.checked && !text.startsWith(header)) els.transcript.value = header + text;
  if (!els.includeHeader.checked && text.startsWith(header)) els.transcript.value = text.slice(header.length);
}

// Transcribe
els.transcribe.addEventListener('click', async () => {
  const file = els.file.files[0];
  showError('');
  setBusy(true);

  const started = performance.now();
  const timer = setInterval(() => {
    els.label.textContent = `Transcribing… ${Math.floor((performance.now() - started) / 1000)}s`;
  }, 250);

  try {
    els.label.textContent = 'Reading file…';
    const data = await readBase64(file);
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${els.apiKey.value.trim()}`,
        'Content-Type': 'application/json',
        'X-Title': 'Teetor',
      },
      body: JSON.stringify({ model: els.model.value.trim(), input_audio: { data, format: 'mp3' } }),
    });
    const elapsed = (performance.now() - started) / 1000;
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error?.message || `HTTP ${res.status} ${res.statusText}`);

    baseName = file.name.replace(/\.[^.]+$/, '');
    header = `File: ${file.name}\nDate: ${formatDate(new Date(file.lastModified))}\n\n`;
    els.transcript.value = body.text || '';
    applyHeader();

    renderStats(body, file, elapsed, res.headers);
    els.results.classList.remove('d-none');
    els.results.scrollIntoView({ behavior: 'smooth' });
  } catch (err) {
    showError(err.message);
  } finally {
    clearInterval(timer);
    setBusy(false);
    updateButton();
  }
});

function renderStats(body, file, elapsed, headers) {
  const u = body.usage || {};
  const text = body.text || '';
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  const speed = u.seconds && elapsed ? u.seconds / elapsed : null;
  const costPerMin = u.cost != null && u.seconds ? (u.cost / u.seconds) * 60 : null;

  const cards = [
    ['Audio length', u.seconds != null ? formatDuration(u.seconds) : '—', u.seconds != null ? `${u.seconds} s` : ''],
    ['Processing time', `${elapsed.toFixed(1)} s`, speed ? `${speed.toFixed(1)}× real time` : ''],
    ['Cost', u.cost != null ? `$${u.cost.toFixed(6)}` : '—', costPerMin != null ? `$${costPerMin.toFixed(5)} / audio min` : ''],
    ['Words', num(words), `${num(text.length)} characters`],
  ];
  els.statCards.innerHTML = '';
  for (const [label, value, sub] of cards) {
    const col = document.createElement('div');
    col.className = 'col-6 col-md-3';
    col.innerHTML = `<div class="card h-100"><div class="card-body">
      <div class="stat-label text-body-secondary"></div>
      <div class="stat-value"></div>
      <div class="small text-body-secondary"></div></div></div>`;
    const [l, v, s] = col.querySelectorAll('.card-body > div');
    l.textContent = label; v.textContent = value; s.textContent = sub;
    els.statCards.appendChild(col);
  }

  const details = [
    ['Model', els.model.value.trim()],
    ['Provider', headers.get('X-Provider-Name')],
    ['Input tokens', num(u.input_tokens)],
    ['Output tokens', num(u.output_tokens)],
    ['Total tokens', num(u.total_tokens)],
    ['File', `${file.name} (${formatBytes(file.size)})`],
    ['File date', formatDate(new Date(file.lastModified))],
    ['Words per minute', u.seconds ? num(Math.round(words / (u.seconds / 60))) : null],
    ['Generation ID', headers.get('X-Generation-Id')],
  ];
  els.statDetails.innerHTML = '';
  for (const [label, value] of details) {
    if (value == null || value === '—') continue;
    const li = document.createElement('li');
    li.className = 'list-group-item d-flex justify-content-between gap-3';
    li.innerHTML = '<span class="text-body-secondary"></span><span class="text-end text-break font-monospace"></span>';
    li.children[0].textContent = label;
    li.children[1].textContent = value;
    els.statDetails.appendChild(li);
  }
}

// Output
els.download.addEventListener('click', () => {
  const blob = new Blob([els.transcript.value], { type: 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${baseName}.txt`;
  a.click();
  URL.revokeObjectURL(a.href);
});

els.copy.addEventListener('click', async () => {
  await navigator.clipboard.writeText(els.transcript.value);
  els.copy.textContent = 'Copied';
  setTimeout(() => (els.copy.textContent = 'Copy'), 1500);
});

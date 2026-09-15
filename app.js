const API_URL = 'https://openrouter.ai/api/v1/audio/transcriptions';
const $ = (id) => document.getElementById(id);

const els = {
  apiKey: $('apiKey'), toggleKey: $('toggleKey'), model: $('model'), file: $('audioFile'),
  includeHeader: $('includeHeader'), transcribe: $('transcribe'), spinner: $('spinner'),
  label: $('transcribeLabel'), error: $('error'), results: $('results'),
  statCards: $('statCards'), statDetails: $('statDetails'), transcript: $('transcript'),
  copy: $('copy'), download: $('download'), progress: $('progress'), progressText: $('progressText'),
  timer: $('timer'), cancel: $('cancel'), progressBar: $('progressBar'), providerOptions: $('providerOptions'),
};

let header = '';       // Header text for the current file ('' if no result yet)
let baseName = 'transcript';
let controller = null; // AbortController while a request is in progress
let unsaved = false;   // True when the transcript is not downloaded or copied

// Warn before the page closes if data can be lost
window.addEventListener('beforeunload', (e) => {
  if (controller || unsaved) e.preventDefault();
});
els.transcript.addEventListener('input', () => (unsaved = true));
els.cancel.addEventListener('click', () => {
  if (controller && confirm('Cancel the transcription?\n\nThe text of parts that are not finished will be lost. OpenRouter can still charge for the current request.')) {
    controller.abort();
  }
});

// Preferences
els.apiKey.value = localStorage.getItem('teetor.apiKey') || '';
els.model.value = localStorage.getItem('teetor.model') || '';
els.includeHeader.checked = localStorage.getItem('teetor.includeHeader') !== 'false';

els.apiKey.addEventListener('input', () => { localStorage.setItem('teetor.apiKey', els.apiKey.value.trim()); updateButton(); });
els.model.addEventListener('input', () => { localStorage.setItem('teetor.model', els.model.value.trim()); updateButton(); });
els.file.addEventListener('change', updateButton);

els.providerOptions.value = localStorage.getItem('teetor.providerOptions') || '';
els.providerOptions.addEventListener('input', () => {
  localStorage.setItem('teetor.providerOptions', els.providerOptions.value);
  els.providerOptions.classList.toggle('is-invalid', parseProvider() === null);
});
els.providerOptions.dispatchEvent(new Event('input'));

// Returns the provider settings object, undefined if the field is empty, or null if the JSON is not valid
function parseProvider() {
  const value = els.providerOptions.value.trim();
  if (!value) return undefined;
  try {
    const obj = JSON.parse(value);
    return obj && typeof obj === 'object' && !Array.isArray(obj) ? obj : null;
  } catch {
    return null;
  }
}

// Drag and drop
const dropZone = $('dropZone');
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => e.preventDefault());
dropZone.addEventListener('dragover', () => dropZone.classList.add('dragover'));
dropZone.addEventListener('dragleave', (e) => { if (!dropZone.contains(e.relatedTarget)) dropZone.classList.remove('dragover'); });
dropZone.addEventListener('drop', (e) => {
  dropZone.classList.remove('dragover');
  const file = [...e.dataTransfer.files].find((f) => /\.mp3$/i.test(f.name) || f.type === 'audio/mpeg');
  if (!file) return showError('Drop an MP3 file.');
  showError('');
  const dt = new DataTransfer();
  dt.items.add(file);
  els.file.files = dt.files;
  updateButton();
});
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
  els.label.textContent = busy ? 'Transcribing…' : 'Transcribe';
  els.progress.classList.toggle('d-none', !busy);
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

// Split large files into parts. OpenRouter rejects large uploads (HTTP 413), and
// providers time out after approximately 60 s of processing for each request.
// 8 MB is approximately 8 minutes of 128 kbps audio.
const PART_BYTES = 8 * 1024 * 1024;
// Audio around each split point that the page examines for a pause (approximately 38 s of 128 kbps audio)
const WINDOW_BYTES = 600 * 1024;

const BITRATES = { 1: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320], 2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160] };
const SAMPLE_RATES = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };

// Returns the length, samples and sample rate of the MP3 frame at b[i], or null if there is no frame header at b[i]
function frameInfo(b, i) {
  if (b[i] !== 0xFF || (b[i + 1] & 0xE0) !== 0xE0) return null;
  const version = b[i + 1] >> 3 & 3, layer = b[i + 1] >> 1 & 3;
  const bitrateIndex = b[i + 2] >> 4, rateIndex = b[i + 2] >> 2 & 3;
  if (version === 1 || layer !== 1 || bitrateIndex === 0 || bitrateIndex === 15 || rateIndex === 3) return null;
  const bitrate = BITRATES[version === 3 ? 1 : 2][bitrateIndex] * 1000;
  const rate = SAMPLE_RATES[version][rateIndex];
  const samples = version === 3 ? 1152 : 576;
  return { length: Math.floor(samples / 8 * bitrate / rate) + (b[i + 2] >> 1 & 1), samples, rate };
}

// Returns the position of the first MP3 frame at or after pos. The next frame must also be valid.
async function findFrame(file, pos) {
  const b = new Uint8Array(await file.slice(pos, pos + 65536).arrayBuffer());
  for (let i = 0; i + 3 < b.length; i++) {
    const f = frameInfo(b, i);
    if (f && frameInfo(b, i + f.length)) return pos + i;
  }
  return pos;
}

// Returns a split position near pos at the quietest 500 ms of the audio, so that the split is not in a word
async function findQuietSplit(file, pos) {
  try {
    const from = await findFrame(file, pos - WINDOW_BYTES / 2);
    const b = new Uint8Array(await file.slice(from, from + WINDOW_BYTES).arrayBuffer());
    const audio = await new OfflineAudioContext(1, 1, 44100).decodeAudioData(b.slice().buffer);

    // Energy of each 50 ms block
    const samples = audio.getChannelData(0);
    const block = Math.round(audio.sampleRate / 20);
    const energy = [];
    for (let i = 0; i + block <= samples.length; i += block) {
      let sum = 0;
      for (let j = i; j < i + block; j++) sum += samples[j] * samples[j];
      energy.push(sum);
    }

    // Quietest 10 blocks. Ignore the first and last 10 % of the window, because decoding there is not reliable.
    const size = 10;
    let best = -1, bestSum = Infinity;
    for (let i = Math.floor(energy.length * 0.1); i + size <= Math.ceil(energy.length * 0.9); i++) {
      const sum = energy.slice(i, i + size).reduce((a, v) => a + v, 0);
      if (sum < bestSum) { bestSum = sum; best = i; }
    }
    if (best < 0) return findFrame(file, pos);
    const quiet = (best + size / 2) * block / audio.sampleRate;

    // Walk the frames to the first frame that starts at the quiet time
    let i = 0, t = 0;
    while (t < quiet) {
      const f = frameInfo(b, i);
      if (!f) return findFrame(file, from + Math.round(quiet / audio.duration * b.length));
      t += f.samples / f.rate;
      i += f.length;
    }
    return from + i;
  } catch {
    return findFrame(file, pos);
  }
}

// Splits the file into parts that start on MP3 frames at pauses in the audio
async function splitMp3(file) {
  const parts = [];
  let start = 0;
  while (start < file.size) {
    const end = file.size - start > PART_BYTES * 1.5 ? await findQuietSplit(file, start + PART_BYTES) : file.size;
    parts.push(file.slice(start, end));
    start = end;
  }
  return parts;
}

async function transcribePart(blob, provider) {
  const data = await readBase64(blob);
  const res = await fetch(API_URL, {
    signal: controller.signal,
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${els.apiKey.value.trim()}`,
      'Content-Type': 'application/json',
      'X-Title': 'Teetor',
    },
    body: JSON.stringify({ model: els.model.value.trim(), input_audio: { data, format: 'mp3' }, provider }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error?.message || `HTTP ${res.status} ${res.statusText}`);
  return { body, headers: res.headers };
}

// Transcribe
els.transcribe.addEventListener('click', async () => {
  const file = els.file.files[0];
  const provider = parseProvider();
  if (provider === null) return showError('Provider settings: this is not a valid JSON object.');
  if (unsaved && !confirm('Start a new transcription?\n\nThe current transcript is not downloaded or copied. It will be lost.')) return;
  showError('');
  setBusy(true);
  controller = new AbortController();

  const started = performance.now();
  const tick = () => {
    const s = (performance.now() - started) / 1000;
    els.timer.textContent = `${Math.floor(s / 60)}:${pad(Math.floor(s % 60))}.${Math.floor((s * 10) % 10)}`;
  };
  tick();
  const timer = setInterval(tick, 100);

  const results = [];
  let parts = [];
  let failure = null;
  try {
    els.progressText.textContent = 'Reading file…';
    parts = await splitMp3(file);
    for (let i = 0; i < parts.length; i++) {
      const prefix = parts.length > 1 ? `Part ${i + 1} of ${parts.length}: ` : '';
      els.progressText.textContent = `${prefix}waiting for OpenRouter…`;
      els.progressBar.style.width = `${((i + 1) / parts.length) * 100}%`;
      results.push(await transcribePart(parts[i], provider));
    }
  } catch (err) {
    failure = err;
  } finally {
    controller = null;
    clearInterval(timer);
    setBusy(false);
    updateButton();
  }
  const elapsed = (performance.now() - started) / 1000;

  // Show the text of the finished parts, also when a later part failed
  if (results.length) {
    baseName = file.name.replace(/\.[^.]+$/, '');
    header = `File: ${file.name}\nDate: ${formatDate(new Date(file.lastModified))}\n\n`;
    const hasSpeakers = results.some((r) => r.body.segments?.some((s) => s.speaker != null));
    els.transcript.value = results.map((r) => partText(r.body)).join(hasSpeakers ? '\n\n' : ' ');
    applyHeader();
    unsaved = true;
    renderStats(results, file, elapsed, parts.length);
    els.results.classList.remove('d-none');
    if (!failure) els.results.scrollIntoView({ behavior: 'smooth' });
  }

  if (failure) {
    let msg;
    if (failure.name === 'AbortError') msg = 'Transcription cancelled.';
    else {
      // fetch() gives a TypeError when the browser blocks or loses the response
      msg = failure instanceof TypeError
        ? `The browser did not get a readable response from OpenRouter (network problem or timeout). Browser message: ${failure.message}.`
        : `${failure.message.replace(/\.?$/, '.')}`;
      if (parts.length > 1) msg = `Part ${results.length + 1} of ${parts.length} failed: ${msg}`;
    }
    if (results.length) msg += ` The transcript below has only ${results.length} of ${parts.length} parts.`;
    showError(msg);
  }
});

// Returns the text of one part. If the segments have speaker labels, each change of speaker starts a new paragraph.
function partText(body) {
  const segments = body.segments || [];
  if (!segments.some((s) => s.speaker != null)) return (body.text || '').trim();
  const turns = [];
  for (const s of segments) {
    const text = (s.text || '').trim();
    const last = turns[turns.length - 1];
    if (last && last.speaker === s.speaker) last.text += ' ' + text;
    else turns.push({ speaker: s.speaker, text });
  }
  return turns.map((t) => `Speaker ${t.speaker}: ${t.text}`).join('\n\n');
}

function renderStats(results, file, elapsed, totalParts) {
  // Add the usage values of all parts. A value is null if no part has it.
  const u = {};
  for (const key of ['seconds', 'input_tokens', 'output_tokens', 'total_tokens', 'cost']) {
    const values = results.map((r) => r.body.usage?.[key]).filter((v) => v != null);
    u[key] = values.length ? values.reduce((a, v) => a + v, 0) : null;
  }
  const headerValues = (name) => [...new Set(results.map((r) => r.headers.get(name)).filter(Boolean))].join(', ') || null;
  const text = results.map((r) => (r.body.text || '').trim()).join(' ');
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  const speed = u.seconds && elapsed ? u.seconds / elapsed : null;
  const costPerMin = u.cost != null && u.seconds ? (u.cost / u.seconds) * 60 : null;

  const cards = [
    ['Audio length', u.seconds != null ? formatDuration(u.seconds) : '—', u.seconds != null ? `${u.seconds.toFixed(1)} s` : ''],
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
    ['Provider', headerValues('X-Provider-Name')],
    ['Parts', totalParts > 1 ? `${results.length} of ${totalParts}` : null],
    ['Input tokens', num(u.input_tokens)],
    ['Output tokens', num(u.output_tokens)],
    ['Total tokens', num(u.total_tokens)],
    ['File', `${file.name} (${formatBytes(file.size)})`],
    ['File date', formatDate(new Date(file.lastModified))],
    ['Words per minute', u.seconds ? num(Math.round(words / (u.seconds / 60))) : null],
    [results.length > 1 ? 'Generation IDs' : 'Generation ID', headerValues('X-Generation-Id')],
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
  unsaved = false;
});

els.copy.addEventListener('click', async () => {
  await navigator.clipboard.writeText(els.transcript.value);
  unsaved = false;
  els.copy.textContent = 'Copied';
  setTimeout(() => (els.copy.textContent = 'Copy'), 1500);
});

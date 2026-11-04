/** Small DOM helpers for the panels. */
export function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') e.innerHTML = v;
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) e.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return e;
}

export function section(title, ...children) {
  return el('section', { class: 'card' }, title ? el('h3', {}, title) : null, ...children);
}

export function button(label, onClick, cls = '') {
  return el('button', { class: `btn ${cls}`, onClick }, label);
}

export function row(...children) {
  return el('div', { class: 'row' }, ...children);
}

export function note(text, cls = '') {
  return el('p', { class: `note ${cls}` }, text);
}

/** Range slider + synchronised number field. */
export function slider({ label, min, max, step = 1, value, unit = '', onInput, onChange, digits }) {
  const range = el('input', { type: 'range', min, max, step, value });
  const num = el('input', { type: 'number', min, max, step, value, class: 'num' });
  const fmt = (v) => (digits != null ? Number(v).toFixed(digits) : v);
  num.value = fmt(value);
  const emit = (v, final) => {
    v = Number(v);
    if (!Number.isFinite(v)) return;
    (final ? onChange ?? onInput : onInput)?.(v);
  };
  range.addEventListener('input', () => { num.value = fmt(range.value); emit(range.value, false); });
  range.addEventListener('change', () => emit(range.value, true));
  num.addEventListener('change', () => { range.value = num.value; emit(num.value, true); });
  const root = el('div', { class: 'field slider' },
    el('label', {}, label),
    el('div', { class: 'slider-line' }, range, num, unit ? el('span', { class: 'unit' }, unit) : null));
  return {
    root,
    set(v) { range.value = v; num.value = fmt(v); },
    setRange(a, b) { range.min = a; range.max = b; num.min = a; num.max = b; },
    get value() { return Number(num.value); },
  };
}

export function numberInput({ value, step = 1, min, max, onChange, width = 64 }) {
  const i = el('input', { type: 'number', value, step, min, max, class: 'num', style: `width:${width}px` });
  i.addEventListener('change', () => {
    const v = Number(i.value);
    if (Number.isFinite(v)) onChange(v);
  });
  return i;
}

export function checkbox(label, checked, onChange) {
  const i = el('input', { type: 'checkbox' });
  i.checked = checked;
  i.addEventListener('change', () => onChange(i.checked));
  return { root: el('label', { class: 'check' }, i, label), input: i };
}

export function selectField(label, options, value, onChange) {
  const s = el('select', {}, options.map(([v, t]) => el('option', { value: v }, t)));
  s.value = value;
  s.addEventListener('change', () => onChange(s.value));
  return { root: el('div', { class: 'field' }, el('label', {}, label), s), input: s };
}

export function segmented(options, value, onChange) {
  const root = el('div', { class: 'segmented' });
  const btns = options.map(([v, t]) => {
    const b = el('button', { class: v === value ? 'on' : '', onClick: () => set(v, true) }, t);
    b.dataset.v = v;
    root.append(b);
    return b;
  });
  function set(v, emit) {
    for (const b of btns) b.classList.toggle('on', b.dataset.v === v);
    if (emit) onChange(v);
  }
  return { root, set };
}

export function stat(label) {
  const v = el('span', { class: 'stat-v' }, '—');
  return { root: el('div', { class: 'stat' }, el('span', { class: 'stat-l' }, label), v), set: (t) => (v.textContent = t) };
}

// A small Markdown renderer for the Markdown widget and the platform's docs: headings,
// paragraphs, emphasis, code, links, images, lists (one level of nesting), quotes, rules and pipe
// tables. Raw HTML in the source is shown as text unless allowHtml is on, and link targets are
// limited to web, mail and local addresses. headings() and slug() name the headings the way
// GitHub does, so an anchor written against a page on GitHub works here too. Pure string work,
// so it runs in tests and on the server as well as in the browser.

const BLOCK_START = /^(?:#{1,6}\s|```|>|\s*[-*+]\s+|\s*\d+[.)]\s+|(?:-{3,}|\*{3,}|_{3,})\s*$|\|)/;
// A fence opens with its language, and whatever follows the language (a title, say) is ignored.
const FENCE_OPEN = /^```\s*([\w+-]*)[^`]*$/;
const FENCE_CLOSE = /^```\s*$/;
// Placeholders the inline pass parks finished HTML behind, so later rules never touch it: a
// code span, a link's tags, an image. They are control characters no source text carries.
const HOLD = '\u0000';
const HOLD_RE = /\u0000(\d+)\u0000/g;
// A hard line break, marked until the inline pass has escaped the text.
const BREAK = '\u0001';
const BREAK_RE = /\u0001/g;
// A URL runs to its closing paren; a pair of parens inside it stays with it, so
// [a](./x_(y).md) works and "(see [a](./a.md))." keeps the last paren out of the link.
const URL_PART = '((?:[^\\s()]|\\([^\\s()]*\\))+)';

export function escapeHtml(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Only addresses a form can sensibly point at; anything else (javascript:, data:) is dropped.
export function safeUrl(url) {
  const trimmed = String(url || '').trim();
  if (/^(https?:|mailto:|\/|#|\.\/|\.\.\/)/i.test(trimmed)) return trimmed;
  return '';
}

export function renderMarkdown(source, options = {}) {
  const allowHtml = Boolean(options.allowHtml);
  const lines = String(source ?? '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i += 1;
      continue;
    }

    let m = FENCE_OPEN.exec(line);
    if (m) {
      const code = [];
      i += 1;
      while (i < lines.length && !FENCE_CLOSE.test(lines[i])) code.push(lines[i++]);
      i += 1;
      out.push(`<pre><code${m[1] ? ` class="language-${escapeHtml(m[1])}"` : ''}>${escapeHtml(code.join('\n'))}</code></pre>`);
      continue;
    }

    // Closing hashes count only after a space: "## C#" keeps its #.
    m = /^(#{1,6})\s+(.*?)(?:\s+#+)?\s*$/.exec(line);
    if (m) {
      out.push(`<h${m[1].length}>${inline(m[2], allowHtml)}</h${m[1].length}>`);
      i += 1;
      continue;
    }

    if (/^(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      out.push('<hr>');
      i += 1;
      continue;
    }

    if (/^>/.test(line)) {
      const quoted = [];
      while (i < lines.length && /^>/.test(lines[i])) quoted.push(lines[i++].replace(/^>\s?/, ''));
      out.push(`<blockquote>${renderMarkdown(quoted.join('\n'), options)}</blockquote>`);
      continue;
    }

    if (/^\s*[-*+]\s+/.test(line) || /^\s*\d+[.)]\s+/.test(line)) {
      i = list(lines, i, out, allowHtml);
      continue;
    }

    if (/^\|/.test(line) && i + 1 < lines.length && /^\|?\s*:?-{2,}/.test(lines[i + 1])) {
      i = table(lines, i, out, allowHtml);
      continue;
    }

    const paragraph = [];
    while (i < lines.length && lines[i].trim() && (paragraph.length === 0 || !BLOCK_START.test(lines[i]))) {
      paragraph.push(lines[i++]);
    }
    // Two trailing spaces make a hard line break; otherwise the lines run together.
    const text = paragraph.map((l, index) => (index < paragraph.length - 1 && /\s{2,}$/.test(l) ? `${l.trimEnd()}${BREAK}` : l.trim())).join(' ');
    out.push(`<p>${inline(text, allowHtml).replace(BREAK_RE, '<br>')}</p>`);
  }
  return out.join('\n');
}

function list(lines, start, out, allowHtml) {
  const marker = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
  const first = marker.exec(lines[start]);
  const ordered = /\d/.test(first[2]);
  const baseIndent = first[1].length;
  const items = [];
  let i = start;
  while (i < lines.length) {
    // A blank line between two items of the list keeps the list going (a "loose" list).
    if (!lines[i].trim()) {
      let j = i + 1;
      while (j < lines.length && !lines[j].trim()) j += 1;
      const next = j < lines.length ? marker.exec(lines[j]) : null;
      if (items.length && next && next[1].length === baseIndent && /\d/.test(next[2]) === ordered) {
        i = j;
        continue;
      }
      break;
    }
    const m = marker.exec(lines[i]);
    if (!m) {
      // A continuation line indented under the item belongs to it.
      if (items.length && /^\s{2,}\S/.test(lines[i])) {
        items[items.length - 1].text += ` ${lines[i].trim()}`;
        i += 1;
        continue;
      }
      break;
    }
    const indent = m[1].length;
    if (indent > baseIndent && items.length) {
      items[items.length - 1].children.push(lines[i]);
      i += 1;
      continue;
    }
    if (indent < baseIndent) break;
    items.push({ text: m[3], children: [] });
    i += 1;
  }
  const tag = ordered ? 'ol' : 'ul';
  // An ordered list keeps the number it starts from.
  const from = ordered ? parseInt(first[2], 10) : 1;
  const html = items
    .map((item) => {
      let inner = inline(item.text, allowHtml);
      if (item.children.length) {
        const nested = [];
        list(item.children, 0, nested, allowHtml);
        inner += nested.join('');
      }
      return `<li>${inner}</li>`;
    })
    .join('');
  out.push(`<${tag}${from !== 1 ? ` start="${from}"` : ''}>${html}</${tag}>`);
  return i;
}

// The cells of a table row. A | inside a code span, or written as \|, belongs to the cell.
function cells(line) {
  const row = line.trim().replace(/^\|/, '').replace(/(?<!\\)\|$/, '');
  const out = [];
  let cell = '';
  let inCode = false;
  for (let i = 0; i < row.length; i += 1) {
    const ch = row[i];
    if (ch === '\\' && row[i + 1] === '|') {
      cell += '|';
      i += 1;
      continue;
    }
    if (ch === '`') inCode = !inCode;
    if (ch === '|' && !inCode) {
      out.push(cell.trim());
      cell = '';
      continue;
    }
    cell += ch;
  }
  out.push(cell.trim());
  return out;
}

function table(lines, start, out, allowHtml) {
  const header = cells(lines[start]);
  const aligns = cells(lines[start + 1]).map((c) => (/^:-+:$/.test(c) ? 'center' : /-+:$/.test(c) ? 'right' : ''));
  let i = start + 2;
  const rows = [];
  while (i < lines.length && /^\|/.test(lines[i])) rows.push(cells(lines[i++]));
  const cell = (tag, text, index) => `<${tag}${aligns[index] ? ` style="text-align:${aligns[index]}"` : ''}>${inline(text, allowHtml)}</${tag}>`;
  const head = `<thead><tr>${header.map((h, index) => cell('th', h, index)).join('')}</tr></thead>`;
  const body = rows.length
    ? `<tbody>${rows.map((r) => `<tr>${header.map((_, index) => cell('td', r[index] ?? '', index)).join('')}</tr>`).join('')}</tbody>`
    : '';
  out.push(`<table>${head}${body}</table>`);
  return i;
}

// Inline marks. Code spans, then images and the tags of links, are parked behind placeholders
// as they are made, so the emphasis rules never reach inside them (an underscore in a URL or a
// caption stays an underscore); a link's label stays in the text and takes emphasis as usual.
export function inline(text, allowHtml = false) {
  const held = [];
  const hold = (html, plain = '') => {
    held.push({ html, plain });
    return `${HOLD}${held.length - 1}${HOLD}`;
  };
  // A caption or a title is an attribute: a code span inside it gives its text, not its tags.
  const plain = (value) => String(value ?? '').replace(HOLD_RE, (_, index) => held[Number(index)].plain);
  let s = String(text).replace(/`([^`]+)`/g, (_, code) => hold(`<code>${escapeHtml(code)}</code>`, allowHtml ? code : escapeHtml(code)));
  if (!allowHtml) s = escapeHtml(s);
  // After escaping, the text is already safe for attributes; with raw HTML allowed it is not.
  const attr = allowHtml ? (value) => escapeHtml(plain(value)) : (value) => plain(value);
  const quote = '(?:"|&quot;)';
  const image = new RegExp(`!\\[([^\\]]*)\\]\\(${URL_PART}(?:\\s+${quote}(.*?)${quote})?\\)`, 'g');
  const link = new RegExp(`\\[([^\\]]+)\\]\\(${URL_PART}(?:\\s+${quote}(.*?)${quote})?\\)`, 'g');
  s = s.replace(image, (_, alt, url, title) => {
    const href = safeUrl(plain(url));
    if (!href) return alt;
    return hold(`<img src="${attr(href)}" alt="${attr(alt)}"${title ? ` title="${attr(title)}"` : ''}>`);
  });
  s = s.replace(link, (_, label, url, title) => {
    const href = safeUrl(plain(url));
    if (!href) return label;
    const external = /^https?:/i.test(href) ? ' target="_blank" rel="noopener"' : '';
    return `${hold(`<a href="${attr(href)}"${title ? ` title="${attr(title)}"` : ''}${external}>`)}${label}${hold('</a>')}`;
  });
  s = s.replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, '<strong>$1</strong>');
  // Underscores mark emphasis only at word edges: snake_case and dunder__names__ stay as written.
  s = s.replace(/(^|[^_\w])__(?=\S)([\s\S]*?\S)__(?![_\w])/g, '$1<strong>$2</strong>');
  s = s.replace(/(^|[^*\w])\*(?=\S)([^*]*?\S)\*/g, '$1<em>$2</em>');
  s = s.replace(/(^|[^_\w])_(?=\S)([^_]*?\S)_(?!\w)/g, '$1<em>$2</em>');
  s = s.replace(/~~(?=\S)([\s\S]*?\S)~~/g, '<del>$1</del>');
  return s.replace(HOLD_RE, (_, index) => held[Number(index)].html);
}

// The anchor GitHub gives a heading: lower case, punctuation dropped (letters, digits, marks,
// underscores, hyphens and spaces stay), spaces turned into hyphens.
export function slug(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc}\- ]/gu, '')
    .replace(/ /g, '-');
}

const ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"' };

// Every heading of a document, in order, as rendered: { level, text, slug }. The text is what
// the reader sees (inline marks gone), so a heading inside a code fence is never one, and a
// repeated heading gets -1, -2 after its slug, as on GitHub.
export function headings(source) {
  const html = renderMarkdown(source);
  const seen = new Map();
  const out = [];
  for (const m of html.matchAll(/<h([1-6])>([\s\S]*?)<\/h\1>/g)) {
    const text = m[2].replace(/<[^>]*>/g, '').replace(/&(?:amp|lt|gt|quot);/g, (e) => ENTITIES[e]).trim();
    const base = slug(text);
    const count = seen.get(base) || 0;
    seen.set(base, count + 1);
    out.push({ level: Number(m[1]), text, slug: count ? `${base}-${count}` : base });
  }
  return out;
}

// Minimal Markdown renderer for the Waterdeep pages (campaign guide entry bodies).
// Supports the subset that's actually useful in an Obsidian note: bold, italic,
// strikethrough, inline code, links, headings, bullet/numbered lists, blockquotes
// and horizontal rules.
//
// The source text is HTML-escaped *first*, so the only tags that can reach the
// page are the ones this file emits.

function wdEscapeHtml(str) {
  return String(str).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

// Only http(s), mailto, in-page and relative targets — no javascript: links.
const WD_SAFE_HREF = /^(https?:\/\/|mailto:|#|\/|\.{0,2}\/|[\w./-]+\.html)/i;

function wdInline(text) {
  // Stash code spans so emphasis markers inside them stay literal.
  const code = [];
  let out = text.replace(/`([^`]+)`/g, (_, body) => {
    code.push(body);
    return '@@' + (code.length - 1) + '@@';
  });

  out = out
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, href) =>
      WD_SAFE_HREF.test(href)
        ? `<a href="${href}" target="_blank" rel="noopener">${label}</a>`
        : label)
    .replace(/\*\*\*([^*]+)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*\n]+)\*/g, '<em>$1</em>')
    .replace(/(^|[^\w])_([^_\n]+)_(?![\w])/g, '$1<em>$2</em>')
    .replace(/~~([^~\n]+)~~/g, '<s>$1</s>');

  return out.replace(/@@(\d+)@@/g, (_, i) => `<code>${code[i]}</code>`);
}

function wdMarkdown(text) {
  const lines = wdEscapeHtml(text || '').replace(/\r\n?/g, '\n').split('\n');
  const html = [];
  let para = [];      // pending paragraph lines
  let list = null;    // { tag: 'ul'|'ol', items: [] }
  let quote = [];     // pending blockquote lines

  const flushPara = () => {
    if (!para.length) return;
    html.push(`<p>${wdInline(para.join('\n')).replace(/\n/g, '<br>')}</p>`);
    para = [];
  };
  const flushQuote = () => {
    if (!quote.length) return;
    html.push(`<blockquote>${wdInline(quote.join('\n')).replace(/\n/g, '<br>')}</blockquote>`);
    quote = [];
  };
  const flushList = () => {
    if (!list) return;
    html.push(`<${list.tag}>${list.items.map(i => `<li>${wdInline(i)}</li>`).join('')}</${list.tag}>`);
    list = null;
  };
  const flushAll = () => { flushPara(); flushQuote(); flushList(); };

  for (const line of lines) {
    const trimmed = line.trim();

    // A blank line ends a paragraph or quote, but a list survives it so that
    // notes with blank-line-separated bullets still render as one list.
    if (!trimmed) { flushPara(); flushQuote(); continue; }

    const heading = trimmed.match(/^(#{1,6})\s+(.*)$/);
    const bullet = trimmed.match(/^[-*+•]\s+(.*)$/);
    const numbered = trimmed.match(/^\d+[.)]\s+(.*)$/);
    const blockquote = trimmed.match(/^>\s?(.*)$/);

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      flushAll();
      html.push('<hr>');
    } else if (heading) {
      flushAll();
      html.push(`<h4 class="wd-md-h">${wdInline(heading[2])}</h4>`);
    } else if (bullet || numbered) {
      flushPara(); flushQuote();
      const tag = bullet ? 'ul' : 'ol';
      if (!list || list.tag !== tag) { flushList(); list = { tag, items: [] }; }
      list.items.push((bullet || numbered)[1]);
    } else if (blockquote) {
      flushPara(); flushList();
      quote.push(blockquote[1]);
    } else {
      flushQuote(); flushList();
      para.push(trimmed);
    }
  }

  flushAll();
  return html.join('');
}

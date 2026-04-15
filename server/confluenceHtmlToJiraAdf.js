/**
 * Convert Confluence storage HTML into Jira Cloud ADF (Atlassian Document Format)
 * for issue descriptions — headings, bold, italic, links, lists, paragraphs, rules, code.
 */
const { parse, HTMLElement, TextNode, NodeType } = require('node-html-parser');

const MAX_DOC_CHARS = 24000;

function stripConfluenceMacros(html) {
  if (!html) return '';
  let s = String(html);
  s = s.replace(/<ac:structured-macro[^>]*>[\s\S]*?<\/ac:structured-macro>/gi, '');
  s = s.replace(/<ac:inline-comment-marker[^>]*>[\s\S]*?<\/ac:inline-comment-marker>/gi, '');
  s = s.replace(/<ac:parameter[^>]*>[\s\S]*?<\/ac:parameter>/gi, '');
  s = s.replace(/<ac:plain-text-body[^>]*>[\s\S]*?<\/ac:plain-text-body>/gi, '');
  s = s.replace(/<ac:rich-text-body[^>]*>[\s\S]*?<\/ac:rich-text-body>/gi, '');
  s = s.replace(/<ac:[^/>][^>]*>[\s\S]*?<\/ac:[^>]+>/gi, '');
  s = s.replace(/<ac:[^/>]*\/>/gi, '');
  s = s.replace(/<ac:[^>]*>/gi, '');
  s = s.replace(/<\/ac:[^>]*>/gi, '');
  s = s.replace(/<!--[\s\S]*?-->/g, '');
  return s;
}

function marksEqual(a, b) {
  return JSON.stringify(a || []) === JSON.stringify(b || []);
}

function mergeAdjacentText(nodes) {
  const out = [];
  for (const n of nodes) {
    if (n.type !== 'text' || !n.text) continue;
    const prev = out[out.length - 1];
    if (prev && prev.type === 'text' && marksEqual(prev.marks, n.marks)) {
      prev.text += n.text;
    } else {
      out.push({ ...n });
    }
  }
  return out;
}

function normalizeParagraphContent(content) {
  const c = mergeAdjacentText(content || []);
  if (c.length === 0) return [{ type: 'text', text: ' ' }];
  return c;
}

/**
 * @param {HTMLElement} el
 * @param {{ type: string, attrs?: object }[]} marks
 * @returns {object[]}
 */
function inlinesToAdf(el, marks = []) {
  if (!el || !el.childNodes) return [];
  const out = [];
  const pushText = (str) => {
    if (str == null || str === '') return;
    const node = { type: 'text', text: str };
    if (marks.length) node.marks = [...marks];
    out.push(node);
  };

  for (const child of el.childNodes) {
    if (child.nodeType === NodeType.TEXT_NODE) {
      const t = child instanceof TextNode ? child.text : String(child.rawText || '');
      if (t) pushText(t);
      continue;
    }
    if (child.nodeType !== NodeType.ELEMENT_NODE) continue;
    const tag = (child.tagName || '').toLowerCase();
    if (tag === 'br') {
      out.push({ type: 'hardBreak' });
    } else if (tag === 'strong' || tag === 'b') {
      out.push(...inlinesToAdf(child, [...marks, { type: 'strong' }]));
    } else if (tag === 'em' || tag === 'i') {
      out.push(...inlinesToAdf(child, [...marks, { type: 'em' }]));
    } else if (tag === 'code') {
      out.push(...inlinesToAdf(child, [...marks, { type: 'code' }]));
    } else if (tag === 'u') {
      out.push(...inlinesToAdf(child, marks));
    } else if (tag === 'a') {
      const href = child.getAttribute('href') || '';
      const linkMark = { type: 'link', attrs: { href } };
      out.push(...inlinesToAdf(child, [...marks, linkMark]));
    } else if (tag === 'span' || tag === 'time' || tag === 'small' || tag === 'sub' || tag === 'sup') {
      out.push(...inlinesToAdf(child, marks));
    } else if (tag === 'img') {
      const alt = child.getAttribute('alt') || 'image';
      pushText(`[${alt}]`);
    } else {
      const inner = child.text || '';
      if (inner.trim()) pushText(inner);
    }
  }
  return mergeAdjacentText(out);
}

function liToListItem(liEl) {
  const content = [];
  for (const n of liEl.childNodes) {
    if (n.nodeType === NodeType.TEXT_NODE) {
      const t = n instanceof TextNode ? n.text : n.rawText;
      if (t && t.trim()) {
        content.push({
          type: 'paragraph',
          content: normalizeParagraphContent([{ type: 'text', text: t.trim() }])
        });
      }
      continue;
    }
    if (n.nodeType !== NodeType.ELEMENT_NODE) continue;
    const tag = (n.tagName || '').toLowerCase();
    if (tag === 'p') {
      content.push({ type: 'paragraph', content: normalizeParagraphContent(inlinesToAdf(n)) });
    } else if (tag === 'ul') {
      content.push(listToAdf(n, 'bullet'));
    } else if (tag === 'ol') {
      content.push(listToAdf(n, 'ordered'));
    } else if (tag === 'div' || tag === 'span') {
      const inner = inlinesToAdf(n);
      if (inner.length) {
        content.push({ type: 'paragraph', content: normalizeParagraphContent(inner) });
      }
    } else {
      const t = n.text || '';
      if (t.trim()) {
        content.push({
          type: 'paragraph',
          content: normalizeParagraphContent([{ type: 'text', text: t.trim() }])
        });
      }
    }
  }
  if (content.length === 0) {
    return { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: ' ' }] }] };
  }
  return { type: 'listItem', content };
}

function listToAdf(listEl, kind) {
  const listType = kind === 'ordered' ? 'orderedList' : 'bulletList';
  const items = [];
  for (const n of listEl.childNodes) {
    if (n.nodeType !== NodeType.ELEMENT_NODE) continue;
    if ((n.tagName || '').toLowerCase() !== 'li') continue;
    items.push(liToListItem(n));
  }
  if (items.length === 0) {
    return {
      type: listType,
      content: [
        {
          type: 'listItem',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: ' ' }] }]
        }
      ]
    };
  }
  return { type: listType, content: items };
}

function tableToParagraphs(tableEl) {
  const rows = [];
  for (const tr of tableEl.querySelectorAll('tr')) {
    const cells = [];
    for (const cell of tr.querySelectorAll('th,td')) {
      const t = (cell.text || '').replace(/\s+/g, ' ').trim();
      if (t) cells.push(t);
    }
    if (cells.length) rows.push(cells.join(' | '));
  }
  const text = rows.length ? rows.join('\n') : (tableEl.text || '').trim().slice(0, 2000);
  return {
    type: 'paragraph',
    content: normalizeParagraphContent(text ? [{ type: 'text', text }] : [{ type: 'text', text: '(table)' }])
  };
}

function elementToBlocks(node) {
  if (node.nodeType !== NodeType.ELEMENT_NODE) return [];
  const tag = (node.tagName || '').toLowerCase();
  switch (tag) {
    case 'p':
      return [{ type: 'paragraph', content: normalizeParagraphContent(inlinesToAdf(node)) }];
    case 'h1':
    case 'h2':
    case 'h3':
    case 'h4':
    case 'h5':
    case 'h6': {
      const level = Number(tag.charAt(1)) || 2;
      const inner = normalizeParagraphContent(inlinesToAdf(node));
      if (inner.length === 1 && inner[0].type === 'text' && !inner[0].text.trim()) return [];
      return [{ type: 'heading', attrs: { level }, content: inner }];
    }
    case 'ul':
      return [listToAdf(node, 'bullet')];
    case 'ol':
      return [listToAdf(node, 'ordered')];
    case 'hr':
      return [{ type: 'rule' }];
    case 'pre': {
      const code = node.querySelector('code');
      const raw = (code ? code.text : node.text) || '';
      const text = raw.length > 12000 ? `${raw.slice(0, 12000)}\n…` : raw;
      return [
        {
          type: 'codeBlock',
          attrs: { language: 'text' },
          content: text ? [{ type: 'text', text }] : [{ type: 'text', text: ' ' }]
        }
      ];
    }
    case 'blockquote': {
      const inner = inlinesToAdf(node);
      return [{ type: 'paragraph', content: normalizeParagraphContent(inner.length ? inner : [{ type: 'text', text: ' ' }]) }];
    }
    case 'table':
      return [tableToParagraphs(node)];
    case 'div':
    case 'section':
    case 'article':
    case 'main':
    case 'header':
    case 'footer':
    case 'aside': {
      const blocks = [];
      for (const c of node.childNodes) {
        if (c.nodeType === NodeType.TEXT_NODE) {
          const t = c instanceof TextNode ? c.text : c.rawText;
          if (t && t.trim()) {
            blocks.push({
              type: 'paragraph',
              content: normalizeParagraphContent([{ type: 'text', text: t.trim() }])
            });
          }
        } else if (c.nodeType === NodeType.ELEMENT_NODE) {
          blocks.push(...elementToBlocks(c));
        }
      }
      return blocks;
    }
    default:
      return [];
  }
}

function walkRootToBlocks(rootEl) {
  const blocks = [];
  for (const child of rootEl.childNodes) {
    if (child.nodeType === NodeType.TEXT_NODE) {
      const t = child instanceof TextNode ? child.text : child.rawText;
      if (t && t.trim()) {
        blocks.push({
          type: 'paragraph',
          content: normalizeParagraphContent([{ type: 'text', text: t.trim() }])
        });
      }
      continue;
    }
    if (child.nodeType === NodeType.ELEMENT_NODE) {
      const tag = (child.tagName || '').toLowerCase();
      const produced = elementToBlocks(child);
      if (produced.length) {
        blocks.push(...produced);
        continue;
      }
      const t = child.text || '';
      if (t.trim()) {
        blocks.push({
          type: 'paragraph',
          content: normalizeParagraphContent([{ type: 'text', text: t.trim() }])
        });
      }
    }
  }
  return blocks;
}

function countTextLenInDoc(doc) {
  let n = 0;
  const walk = (o) => {
    if (!o || typeof o !== 'object') return;
    if (o.type === 'text' && o.text) n += o.text.length;
    if (Array.isArray(o.content)) o.content.forEach(walk);
  };
  walk(doc);
  return n;
}

/**
 * @param {string} html Confluence body.storage HTML
 * @returns {{ type: 'doc', version: 1, content: object[] }}
 */
function confluenceStorageHtmlToJiraAdf(html) {
  const cleaned = stripConfluenceMacros(html);
  const wrapped = `<div class="rn-root">${cleaned}</div>`;
  const root = parse(wrapped, { blockTextElements: { script: true, style: true, pre: false } });
  const holder = root.querySelector('.rn-root');
  if (!holder) {
    return { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: '(empty)' }] }] };
  }
  let content = walkRootToBlocks(holder);
  if (content.length === 0) {
    content = [{ type: 'paragraph', content: [{ type: 'text', text: '(No Confluence body captured)' }] }];
  }
  let doc = { type: 'doc', version: 1, content };
  let chars = countTextLenInDoc(doc);
  while (chars > MAX_DOC_CHARS && doc.content.length > 1) {
    doc.content.pop();
    chars = countTextLenInDoc(doc);
  }
  if (chars > MAX_DOC_CHARS) {
    doc.content = [
      {
        type: 'paragraph',
        content: [{ type: 'text', text: '… (description truncated for Jira size limit)', marks: [{ type: 'em' }] }]
      }
    ];
  }
  return doc;
}

module.exports = { confluenceStorageHtmlToJiraAdf, stripConfluenceMacros };

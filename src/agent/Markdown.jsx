import React from "react";

/** Мини-рендер маркдауна для ответов ассистента: жирный, курсив, код,
 * заголовки, списки, код-блоки. Без зависимостей и без HTML-инъекций. */

function inline(text) {
  const out = [];
  const re = /(`[^`\n]+`|\*\*[^*\n]+\*\*|\*[^*\n]+\*|_[^_\n]+_)/g;
  let last = 0;
  let m;
  let k = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const s = m[0];
    if (s.startsWith("`")) out.push(<code key={k++}>{s.slice(1, -1)}</code>);
    else if (s.startsWith("**")) out.push(<strong key={k++}>{inline(s.slice(2, -2))}</strong>);
    else out.push(<em key={k++}>{inline(s.slice(1, -1))}</em>);
    last = m.index + s.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export default function Markdown({ text }) {
  const lines = String(text || "").split("\n");
  const blocks = [];
  let i = 0;
  let k = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim().startsWith("```")) {
      const buf = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) buf.push(lines[i++]);
      i++;
      blocks.push(<pre key={k++} className="agent-code">{buf.join("\n")}</pre>);
      continue;
    }

    const h = line.match(/^(#{1,4})\s+(.*)/);
    if (h) {
      blocks.push(<div key={k++} className="agent-md-h">{inline(h[2])}</div>);
      i++;
      continue;
    }

    if (/^\s*([-*•]|\d+[.)])\s+/.test(line)) {
      const items = [];
      const ordered = /^\s*\d+[.)]/.test(line);
      while (i < lines.length && /^\s*([-*•]|\d+[.)])\s+/.test(lines[i])) {
        items.push(<li key={items.length}>{inline(lines[i].replace(/^\s*([-*•]|\d+[.)])\s+/, ""))}</li>);
        i++;
      }
      blocks.push(ordered ? <ol key={k++}>{items}</ol> : <ul key={k++}>{items}</ul>);
      continue;
    }

    if (!line.trim()) {
      i++;
      continue;
    }

    const buf = [];
    // Маркер списка — только с пробелом после него, иначе «**жирный**» в начале строки ломает абзац.
    while (i < lines.length && lines[i].trim() && !/^\s*([-*•]\s|\d+[.)]\s|#{1,4}\s|```)/.test(lines[i])) {
      buf.push(lines[i]);
      i++;
    }
    if (!buf.length) { // страховка от зацикливания: строка не подошла ни одному блоку
      buf.push(lines[i]);
      i++;
    }
    blocks.push(
      <p key={k++}>
        {buf.map((l, j) => (
          <React.Fragment key={j}>
            {j > 0 && <br />}
            {inline(l)}
          </React.Fragment>
        ))}
      </p>
    );
  }

  return <div className="agent-md">{blocks}</div>;
}

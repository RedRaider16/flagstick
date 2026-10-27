// Plain-text message → simple HTML (escaped, links clickable, line breaks kept).
// Kept free of Deno APIs so the app's tests can check it too.

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export function textToHtml(text: string, title: string): string {
  const body = text
    .split(/\n{2,}/)
    .map((para) =>
      `<p style="margin:0 0 14px">${esc(para)
        .replace(/https:\/\/[^\s<]+/g, (u) => `<a href="${u}" style="color:#134a34">${u}</a>`)
        .replace(/\n/g, '<br>')}</p>`,
    )
    .join('\n')
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title></head>
<body style="margin:0;background:#f2f5f3;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#22282a">
<div style="max-width:560px;margin:0 auto;padding:24px 16px">
<div style="background:#134a34;color:#fff;font-weight:700;font-size:18px;padding:14px 18px;border-radius:10px 10px 0 0">&#9971; ${esc(title)}</div>
<div style="background:#fff;padding:18px;border:1px solid #cbd5cf;border-top:0;border-radius:0 0 10px 10px;font-size:15px;line-height:1.5">
${body}
</div></div></body></html>`
}

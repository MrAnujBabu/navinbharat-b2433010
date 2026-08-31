/**
 * Report export — turn a generated report into a file the admin can keep.
 *
 * Markdown is a plain Blob download. PDF lazily pulls `html2pdf.js` (already a
 * dependency, used by the Notion renderer) so the ~250 KB library never lands
 * in the main bundle.
 */

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke on the next tick — revoking synchronously cancels the download in
  // some Android WebView versions.
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function downloadMarkdown(markdown: string, filename: string) {
  triggerDownload(new Blob([markdown], { type: "text/markdown;charset=utf-8" }), filename);
}

export async function downloadPdfFromHtml(html: string, filename: string) {
  const holder = document.createElement("div");
  holder.style.position = "fixed";
  holder.style.left = "-10000px";
  holder.style.top = "0";
  holder.style.width = "794px"; // A4 @ 96dpi
  holder.innerHTML = html;
  document.body.appendChild(holder);
  try {
    const mod = await import("html2pdf.js");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const html2pdf = (mod as unknown as { default: any }).default;
    const blob: Blob = await html2pdf()
      .set({
        margin: [10, 8, 12, 8],
        filename,
        image: { type: "jpeg", quality: 0.95 },
        html2canvas: { scale: 2, useCORS: true, backgroundColor: "#ffffff" },
        jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
        pagebreak: { mode: ["css", "legacy"] },
      })
      .from(holder)
      .outputPdf("blob");
    triggerDownload(blob, filename);
  } finally {
    holder.remove();
  }
}

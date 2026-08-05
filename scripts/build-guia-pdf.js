/**
 * Build PDF from docs/guia-analistas-jarvis.md (optional — requires md-to-pdf).
 * Usage: node scripts/build-guia-pdf.js
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const MD_PATH = path.join(ROOT, "docs", "guia-analistas-jarvis.md");
const PDF_PATH = path.join(ROOT, "docs", "guia-analistas-jarvis.pdf");

async function main() {
  if (!fs.existsSync(MD_PATH)) {
    console.error("Missing:", MD_PATH);
    process.exit(1);
  }

  let mdToPdf;
  try {
    mdToPdf = require("md-to-pdf").mdToPdf;
  } catch {
    console.error("Install md-to-pdf first: npm install --save-dev md-to-pdf");
    process.exit(1);
  }

  await mdToPdf(
    { path: MD_PATH },
    {
      dest: PDF_PATH,
      pdf_options: {
        format: "A4",
        margin: { top: "18mm", right: "16mm", bottom: "18mm", left: "16mm" },
        printBackground: true,
      },
      css: `
        body { font-family: Segoe UI, system-ui, sans-serif; font-size: 11pt; line-height: 1.45; color: #1a1a1a; }
        h1 { color: #006837; font-size: 20pt; border-bottom: 2px solid #006837; padding-bottom: 0.3em; }
        h2 { color: #004d28; font-size: 14pt; margin-top: 1.2em; }
        h3 { font-size: 12pt; }
        table { border-collapse: collapse; width: 100%; margin: 0.8em 0; font-size: 10pt; }
        th, td { border: 1px solid #ccc; padding: 6px 8px; text-align: left; }
        th { background: #e8f5ee; }
        code { background: #f4f4f4; padding: 1px 4px; border-radius: 3px; font-size: 0.9em; }
        pre code { display: block; padding: 10px; background: #0b1220; color: #dbeafe; }
        blockquote { border-left: 4px solid #006837; margin: 0; padding-left: 1em; opacity: 0.85; }
      `,
    }
  );

  console.log("PDF written:", PDF_PATH);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});

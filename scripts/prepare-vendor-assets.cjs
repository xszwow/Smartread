const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const vendorDir = path.join(root, "js", "vendor");

const assets = [
  {
    name: "JSZip",
    source: path.join(root, "node_modules", "jszip", "dist", "jszip.min.js"),
    target: "jszip.min.js"
  },
  {
    name: "PDF.js",
    source: path.join(root, "node_modules", "pdfjs-dist", "build", "pdf.min.js"),
    target: "pdf.min.js"
  },
  {
    name: "PDF.js worker",
    source: path.join(root, "node_modules", "pdfjs-dist", "build", "pdf.worker.min.js"),
    target: "pdf.worker.min.js"
  },
  {
    name: "EPUB.js",
    source: path.join(root, "node_modules", "epubjs", "dist", "epub.min.js"),
    target: "epub.min.js"
  },
  {
    name: "Marked",
    source: path.join(root, "node_modules", "marked", "lib", "marked.umd.js"),
    target: "marked.umd.js"
  }
];

fs.mkdirSync(vendorDir, { recursive: true });

const manifest = {};
for (const asset of assets) {
  if (!fs.existsSync(asset.source)) {
    throw new Error(`Missing ${asset.name} asset at ${path.relative(root, asset.source)}. Run npm install first.`);
  }
  const targetPath = path.join(vendorDir, asset.target);
  fs.copyFileSync(asset.source, targetPath);
  const stat = fs.statSync(targetPath);
  manifest[asset.target] = {
    name: asset.name,
    bytes: stat.size,
    source: path.relative(root, asset.source).replace(/\\/g, "/")
  };
  console.log(`[vendor] ${asset.name}: js/vendor/${asset.target} (${stat.size} bytes)`);
}

fs.writeFileSync(
  path.join(vendorDir, "manifest.json"),
  JSON.stringify({ generatedAt: new Date().toISOString(), assets: manifest }, null, 2) + "\n",
  "utf8"
);

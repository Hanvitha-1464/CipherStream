const fs = require("fs");
const zlib = require("zlib");

const pdfPath = process.argv[2];

if (!pdfPath) {
  console.error("Usage: node extract-pdf-text.js <pdf-path>");
  process.exit(1);
}

const raw = fs.readFileSync(pdfPath, "binary");

const objectRegex = /(\d+)\s+(\d+)\s+obj([\s\S]*?)endobj/g;
const objects = new Map();
let match;

while ((match = objectRegex.exec(raw))) {
  const [, id, gen, body] = match;
  objects.set(`${id} ${gen}`, body);
}

function getObject(id) {
  return objects.get(`${id} 0`) || "";
}

function extractStream(body) {
  const streamMatch = body.match(/stream\r?\n([\s\S]*?)endstream/);
  if (!streamMatch) return null;
  const streamBinary = streamMatch[1];
  if (/\/Filter\s*\/FlateDecode/.test(body)) {
    return zlib.inflateSync(Buffer.from(streamBinary, "binary")).toString("binary");
  }
  return streamBinary;
}

function parseCMap(stream) {
  const map = new Map();
  const bfcharMatch = [...stream.matchAll(/(\d+)\s+beginbfchar([\s\S]*?)endbfchar/g)];
  for (const [, , block] of bfcharMatch) {
    const pairRegex = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g;
    let pair;
    while ((pair = pairRegex.exec(block))) {
      const src = pair[1].toUpperCase();
      const dstHex = pair[2];
      const chars = [];
      for (let i = 0; i < dstHex.length; i += 4) {
        chars.push(String.fromCodePoint(parseInt(dstHex.slice(i, i + 4), 16)));
      }
      map.set(src, chars.join(""));
    }
  }
  return map;
}

function parseFontMaps() {
  const fontMaps = new Map();
  for (const [key, body] of objects.entries()) {
    if (!/\/ToUnicode\s+(\d+)\s+0\s+R/.test(body)) continue;
    const baseFontMatch = body.match(/\/BaseFont\s*\/([^\s/]+)/);
    const toUnicodeMatch = body.match(/\/ToUnicode\s+(\d+)\s+0\s+R/);
    if (!toUnicodeMatch) continue;
    const toUnicodeStream = extractStream(getObject(toUnicodeMatch[1]));
    if (!toUnicodeStream) continue;
    const cmap = parseCMap(toUnicodeStream);
    fontMaps.set(key.split(" ")[0], {
      baseFont: baseFontMatch ? baseFontMatch[1] : key,
      cmap,
    });
  }
  return fontMaps;
}

const fontMaps = parseFontMaps();

function parsePageFontRefs(resourceBody) {
  const refs = {};
  const fontSectionMatch = resourceBody.match(/\/Font\s*<<([\s\S]*?)>>/);
  if (!fontSectionMatch) return refs;
  const refRegex = /\/(F\d+)\s+(\d+)\s+0\s+R/g;
  let m;
  while ((m = refRegex.exec(fontSectionMatch[1]))) {
    refs[m[1]] = m[2];
  }
  return refs;
}

function decodeHexString(hex, cmap) {
  let out = "";
  for (let i = 0; i < hex.length; i += 4) {
    const code = hex.slice(i, i + 4).toUpperCase();
    out += cmap.get(code) || "";
  }
  return out;
}

function decodeLiteralString(text) {
  return text
    .replace(/\\\(/g, "(")
    .replace(/\\\)/g, ")")
    .replace(/\\\\/g, "\\");
}

function extractTextFromStream(stream, pageFontRefs) {
  const lines = [];
  let currentFont = null;

  const tokens = stream.match(/\/F\d+\s+\d+(?:\.\d+)?\s+Tf|<[^>]+>\s*Tj|\[(?:[\s\S]*?)\]\s*TJ|\((?:\\.|[^\\)])*\)\s*Tj|T\*|Td|TD|Tm/g) || [];

  for (const token of tokens) {
    const fontMatch = token.match(/\/(F\d+)\s+\d+(?:\.\d+)?\s+Tf/);
    if (fontMatch) {
      currentFont = fontMatch[1];
      continue;
    }

    if (token === "T*" || /\sTd$/.test(token) || /\sTD$/.test(token) || /\sTm$/.test(token)) {
      if (lines.length === 0 || lines[lines.length - 1] !== "") {
        lines.push("");
      }
      continue;
    }

    const fontObj = currentFont ? fontMaps.get(pageFontRefs[currentFont]) : null;
    const cmap = fontObj ? fontObj.cmap : new Map();

    const hexMatch = token.match(/<([^>]+)>\s*Tj/);
    if (hexMatch) {
      if (lines.length === 0) lines.push("");
      lines[lines.length - 1] += decodeHexString(hexMatch[1], cmap);
      continue;
    }

    const litMatch = token.match(/\(((?:\\.|[^\\)])*)\)\s*Tj/);
    if (litMatch) {
      if (lines.length === 0) lines.push("");
      lines[lines.length - 1] += decodeLiteralString(litMatch[1]);
      continue;
    }

    const tjMatch = token.match(/\[([\s\S]*?)\]\s*TJ/);
    if (tjMatch) {
      if (lines.length === 0) lines.push("");
      const itemRegex = /<([^>]+)>|\(((?:\\.|[^\\)])*)\)|(-?\d+(?:\.\d+)?)/g;
      let item;
      while ((item = itemRegex.exec(tjMatch[1]))) {
        if (item[1]) {
          lines[lines.length - 1] += decodeHexString(item[1], cmap);
        } else if (item[2]) {
          lines[lines.length - 1] += decodeLiteralString(item[2]);
        } else if (item[3] && Number(item[3]) < -100) {
          lines[lines.length - 1] += " ";
        }
      }
    }
  }

  return lines
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
}

const pageEntries = [];
for (const [key, body] of objects.entries()) {
  if (!/\/Type\s*\/Page\b/.test(body)) continue;
  const contentsMatch = body.match(/\/Contents\s*\[\s*((?:\d+\s+0\s+R\s*)+)\]/);
  const contentIds = [];
  if (contentsMatch) {
    const idRegex = /(\d+)\s+0\s+R/g;
    let m;
    while ((m = idRegex.exec(contentsMatch[1]))) {
      contentIds.push(m[1]);
    }
  } else {
    const singleMatch = body.match(/\/Contents\s+(\d+)\s+0\s+R/);
    if (singleMatch) contentIds.push(singleMatch[1]);
  }
  pageEntries.push({
    pageObj: key,
    fontRefs: (() => {
      const resourcesMatch = body.match(/\/Resources\s+(\d+)\s+0\s+R/);
      if (!resourcesMatch) return parsePageFontRefs(body);
      return parsePageFontRefs(getObject(resourcesMatch[1]));
    })(),
    contentIds,
  });
}

pageEntries.sort((a, b) => Number(a.pageObj.split(" ")[0]) - Number(b.pageObj.split(" ")[0]));

for (let i = 0; i < pageEntries.length; i++) {
  const page = pageEntries[i];
  const text = page.contentIds
    .map((id) => extractStream(getObject(id)))
    .filter(Boolean)
    .map((stream) => extractTextFromStream(stream, page.fontRefs))
    .join("\n");
  console.log(`--- PAGE ${i + 1} ---`);
  console.log(text);
  console.log("");
}

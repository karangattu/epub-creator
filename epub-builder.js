/**
 * epub-builder.js
 * Core module for compiling standard EPUB 3 and Kobo KePub books on the client-side.
 */

class EPUBBuilder {
  /**
   * Compiles the book state into a JSZip instance.
   * @param {Object} bookData - The book configuration and contents.
   * @param {string} bookData.title - The title of the book.
   * @param {string} bookData.author - The author of the book.
   * @param {string} [bookData.publisher="Self-Published"] - The publisher.
   * @param {string} [bookData.language="en"] - The language code.
   * @param {Blob} [bookData.coverImage] - Cover image Blob.
   * @param {string} [bookData.coverImageType="image/jpeg"] - Cover image MIME type.
   * @param {Array<Object>} bookData.items - Chapters and loose pages.
   * @param {string} bookData.items[].id - Unique ID of the page.
   * @param {string} bookData.items[].title - Page title.
   * @param {string} bookData.items[].content - HTML string.
   * @param {boolean} bookData.items[].isChapter - True if standard chapter, false if loose page.
   * @param {Object} bookData.images - Dictionary mapping image path (e.g. 'images/img1.png') to Blobs.
   * @param {boolean} [options.isKepub=false] - If true, optimizes for Kobo (KePub).
   * @returns {Promise<Blob>} The generated EPUB zip blob.
   */
  static async compile(bookData, options = {}) {
    const isKepub = !!options.isKepub;
    const zip = new JSZip();

    // 1. mimetype: MUST be the first file and uncompressed
    zip.file("mimetype", "application/epub+zip", { compression: "STORE" });

    // 2. META-INF/container.xml
    zip.file(
      "META-INF/container.xml",
      `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`
    );

    // Book variables
    const title = bookData.title || "Untitled Book";
    const author = bookData.author || "Unknown Author";
    const publisher = bookData.publisher || "Self-Published";
    const language = bookData.language || "en";
    const bookId = bookData.uuid || this.generateUUID();
    const modifiedTime = new Date().toISOString().split(".")[0] + "Z"; // Format: YYYY-MM-DDTHH:MM:SSZ

    // Determine cover extension
    let coverExt = "jpg";
    if (bookData.coverImageType === "image/png") coverExt = "png";
    if (bookData.coverImageType === "image/gif") coverExt = "gif";
    const coverPath = `images/cover.${coverExt}`;

    // Add CSS
    zip.file("OEBPS/style.css", this.getDefaultCSS());

    // Prepare files list
    const manifestItems = [];
    const spineItems = [];
    const chaptersList = []; // Elements that appear in TOC

    // 3. Process cover image and add cover page if exists
    if (bookData.coverImage) {
      zip.file(`OEBPS/${coverPath}`, bookData.coverImage);
      manifestItems.push({
        id: "cover-image",
        href: coverPath,
        mediaType: bookData.coverImageType || "image/jpeg",
        properties: "cover-image"
      });

      // Cover Page XHTML wrapper
      const coverPageContent = `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" lang="${language}" xml:lang="${language}">
  <head>
    <title>Cover</title>
    <style type="text/css">
      @page { margin: 0; padding: 0; }
      body { margin: 0; padding: 0; text-align: center; background-color: #ffffff; width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; }
      img { max-width: 100%; max-height: 100%; object-fit: contain; display: block; margin: auto; }
    </style>
  </head>
  <body>
    <img src="${coverPath}" alt="Cover Image"/>
  </body>
</html>`;

      zip.file("OEBPS/cover.xhtml", coverPageContent);
      manifestItems.push({
        id: "cover-page",
        href: "cover.xhtml",
        mediaType: "application/xhtml+xml"
      });
      spineItems.push("cover-page");
    }

    // Navigation document manifest item (required for EPUB 3)
    manifestItems.push({
      id: "nav",
      href: "nav.xhtml",
      mediaType: "application/xhtml+xml",
      properties: "nav"
    });
    spineItems.push("nav");

    // 4. Process all book items (chapters and loose pages)
    let itemCounter = 1;
    for (const item of bookData.items) {
      const sanitizedContent = this.sanitizeToXHTML(item.content);
      let finalHTML = sanitizedContent;

      if (isKepub) {
        // Sentence wrap paragraphs/headings/lists for KePub
        finalHTML = this.wrapSentencesForKepub(finalHTML, itemCounter);
        // Re-sanitize to guarantee XML validity after DOM manipulation
        finalHTML = this.sanitizeToXHTML(finalHTML);
      }

      const fileId = `item-${itemCounter}`;
      const filename = `content/${fileId}.xhtml`;

      const xhtmlContent = `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="${language}" xml:lang="${language}">
  <head>
    <title>${this.escapeXML(item.title)}</title>
    <link rel="stylesheet" type="text/css" href="../style.css"/>
  </head>
  <body>
    <h1>${this.escapeXML(item.title)}</h1>
    <div class="content-body">
      ${finalHTML}
    </div>
  </body>
</html>`;

      zip.file(`OEBPS/${filename}`, xhtmlContent);

      manifestItems.push({
        id: fileId,
        href: filename,
        mediaType: "application/xhtml+xml"
      });
      spineItems.push(fileId);

      // Add to TOC navigation list if it is categorized as a Chapter
      if (item.isChapter) {
        chaptersList.push({
          title: item.title,
          href: filename
        });
      }

      itemCounter++;
    }

    // 5. Add inline pasted images to zip and manifest
    if (bookData.images) {
      for (const [imgPath, imgBlob] of Object.entries(bookData.images)) {
        // Verify path is inside OEBPS
        zip.file(`OEBPS/${imgPath}`, imgBlob);
        
        let mediaType = "image/png";
        if (imgPath.endsWith(".jpg") || imgPath.endsWith(".jpeg")) mediaType = "image/jpeg";
        if (imgPath.endsWith(".gif")) mediaType = "image/gif";
        if (imgPath.endsWith(".svg")) mediaType = "image/svg+xml";

        manifestItems.push({
          id: imgPath.replace(/\//g, "-").replace(/\./g, "-"),
          href: imgPath,
          mediaType: mediaType
        });
      }
    }

    // 6. Navigation file: nav.xhtml (required in EPUB 3)
    const navContent = `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="${language}" xml:lang="${language}">
  <head>
    <title>Navigation</title>
    <link rel="stylesheet" type="text/css" href="style.css"/>
  </head>
  <body>
    <nav epub:type="toc" id="toc">
      <h1>Table of Contents</h1>
      <ol>
        ${chaptersList.map(ch => `<li><a href="${ch.href}">${this.escapeXML(ch.title)}</a></li>`).join("\n        ")}
      </ol>
    </nav>
  </body>
</html>`;
    zip.file("OEBPS/nav.xhtml", navContent);

    // 7. OPF File: OEBPS/content.opf
    const opfContent = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="bookid" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">urn:uuid:${bookId}</dc:identifier>
    <dc:title>${this.escapeXML(title)}</dc:title>
    <dc:creator>${this.escapeXML(author)}</dc:creator>
    <dc:publisher>${this.escapeXML(publisher)}</dc:publisher>
    <dc:language>${language}</dc:language>
    <meta property="dcterms:modified">${modifiedTime}</meta>
  </metadata>
  <manifest>
    ${manifestItems.map(item => `<item id="${item.id}" href="${item.href}" media-type="${item.mediaType}"${item.properties ? ` properties="${item.properties}"` : ""}/>`).join("\n    ")}
  </manifest>
  <spine>
    ${spineItems.map(id => `<itemref idref="${id}"/>`).join("\n    ")}
  </spine>
</package>`;
    zip.file("OEBPS/content.opf", opfContent);

    // 8. Generate Zip Blob
    return await zip.generateAsync({ type: "blob", mimeType: "application/epub+zip" });
  }

  /**
   * Helper to sanitize editor HTML to valid XHTML.
   */
  static sanitizeToXHTML(htmlContent) {
    if (!htmlContent) return "";
    const parser = new DOMParser();
    // Wrap in a div to ensure a single root element during parse
    const doc = parser.parseFromString(`<div>${htmlContent}</div>`, "text/html");
    const root = doc.querySelector("div") || doc.body;

    function serialize(node) {
      if (node.nodeType === Node.TEXT_NODE) {
        return node.nodeValue
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;");
      }
      if (node.nodeType === Node.ELEMENT_NODE) {
        const tagName = node.tagName.toLowerCase();
        
        // Skip tags we don't want in EPUB content
        if (["script", "style", "iframe", "object", "embed"].includes(tagName)) {
          return "";
        }

        let attrs = "";
        for (let i = 0; i < node.attributes.length; i++) {
          const attr = node.attributes[i];
          // If image is locally cached and has data-epub-src, output data-epub-src as src
          if (tagName === "img" && attr.name === "src" && node.hasAttribute("data-epub-src")) {
            attrs += ` src="${node.getAttribute("data-epub-src")}"`;
          } else if (attr.name !== "src" || !node.hasAttribute("data-epub-src")) {
            // Escape double quotes in attribute values
            const val = attr.value.replace(/"/g, "&quot;");
            attrs += ` ${attr.name}="${val}"`;
          }
        }

        // List of self-closing tags in XHTML
        const selfClosing = ["br", "hr", "img", "col", "source", "link", "meta"];
        if (selfClosing.includes(tagName)) {
          return `<${tagName}${attrs} />`;
        } else {
          let children = "";
          node.childNodes.forEach(child => {
            children += serialize(child);
          });
          return `<${tagName}${attrs}>${children}</${tagName}>`;
        }
      }
      return "";
    }

    let xhtml = "";
    root.childNodes.forEach(child => {
      xhtml += serialize(child);
    });
    return xhtml;
  }

  /**
   * Sentence wrapper function that parses block elements in XHTML and wraps
   * each sentence with a span.koboSpan, which triggers advanced Kobo features.
   */
  static wrapSentencesForKepub(xhtmlContent, chapterIndex) {
    if (!xhtmlContent) return "";
    const parser = new DOMParser();
    // Parse as XHTML so standard namespaces are preserved
    const doc = parser.parseFromString(`<div>${xhtmlContent}</div>`, "application/xhtml+xml");
    
    // Check for XML parse errors
    const parserError = doc.querySelector("parsererror");
    if (parserError) {
      // Fallback: If XHTML parsing fails, parse as HTML and clean up
      const htmlDoc = parser.parseFromString(`<div>${xhtmlContent}</div>`, "text/html");
      return this.wrapDocSentences(htmlDoc.querySelector("div"), chapterIndex, htmlDoc);
    }

    return this.wrapDocSentences(doc.querySelector("div"), chapterIndex, doc);
  }

  static wrapDocSentences(root, chapterIndex, doc) {
    let sentenceCounter = 1;

    function processNode(node) {
      // Avoid processing contents of non-textual container nodes
      const tagName = node.nodeType === Node.ELEMENT_NODE ? node.tagName.toLowerCase() : "";
      if (["img", "br", "hr", "code", "pre", "a", "span"].includes(tagName)) {
        return;
      }

      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.nodeValue;
        if (!text.trim()) return;

        // Split text into sentences using lookbehind pattern (safe in modern browsers)
        // Splits after . ! ? followed by whitespace
        const sentences = text.split(/(?<=[.!?])\s+/);
        
        const fragment = doc.createDocumentFragment();
        sentences.forEach((sentence, idx) => {
          if (!sentence.trim()) return;
          
          const span = doc.createElementNS("http://www.w3.org/1999/xhtml", "span");
          span.setAttribute("class", "koboSpan");
          span.setAttribute("id", `kobo.${chapterIndex}.${sentenceCounter++}`);
          
          // Add trailing space back if it was stripped
          const trailingSpace = (idx < sentences.length - 1) ? " " : "";
          span.textContent = sentence + trailingSpace;
          fragment.appendChild(span);
        });

        if (node.parentNode) {
          node.parentNode.replaceChild(fragment, node);
        }
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        // Run in reverse order so replacements do not mess up indices
        const children = Array.from(node.childNodes);
        children.forEach(child => processNode(child));
      }
    }

    root.childNodes.forEach(child => processNode(child));
    return root.innerHTML;
  }

  /**
   * Standard XML character escaping.
   */
  static escapeXML(str) {
    if (!str) return "";
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
  }

  /**
   * Basic UUID generator.
   */
  static generateUUID() {
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
      const r = (Math.random() * 16) | 0;
      const v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  /**
   * Default EPUB formatting stylesheet.
   */
  static getDefaultCSS() {
    return `/* EPUB Core Stylesheet */
body {
  font-family: Georgia, serif;
  margin: 1.5em 8% 2em 8%;
  line-height: 1.6;
  color: #111111;
  background-color: #ffffff;
}

h1 {
  text-align: center;
  margin-top: 2.5em;
  margin-bottom: 1.5em;
  font-size: 1.8em;
  font-weight: bold;
  line-height: 1.2;
}

h2 {
  margin-top: 2em;
  margin-bottom: 1em;
  font-size: 1.4em;
  font-weight: bold;
  line-height: 1.3;
}

p {
  text-indent: 1.5em;
  margin: 0 0 0.5em 0;
  text-align: justify;
}

p:first-of-type, h1 + p, h2 + p {
  text-indent: 0;
}

img {
  max-width: 100%;
  height: auto;
  display: block;
  margin: 1.5em auto;
}

blockquote {
  margin: 1.5em 10%;
  font-style: italic;
  color: #444444;
  border-left: 4px solid #cccccc;
  padding-left: 1.2em;
}

ul, ol {
  margin: 1.5em 0;
  padding-left: 2em;
}

li {
  margin-bottom: 0.5em;
}

.koboSpan {
  /* Empty by default - used by Kobo Access engine */
}`;
  }
}

// Export class globally
window.EPUBBuilder = EPUBBuilder;

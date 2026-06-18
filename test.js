/**
 * test.js
 * Node.js-based unit tests for verifying the EPUB compiler logic on CI.
 */

const fs = require("fs");
const path = require("path");
const assert = require("assert");
const { JSDOM } = require("jsdom");

// 1. Mock browser DOM environment required by epub-builder.js
const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>");
global.window = dom.window;
global.document = dom.window.document;
global.DOMParser = dom.window.DOMParser;
global.Node = dom.window.Node;

// 2. Load JSZip in Node context
global.JSZip = require("jszip");

// 3. Load the epub-builder.js compiler module
const builderCode = fs.readFileSync(path.join(__dirname, "epub-builder.js"), "utf8");
eval(builderCode); // Declares window.EPUBBuilder

const EPUBBuilder = window.EPUBBuilder;

// 4. Run Test Assertions
console.log("Starting unit tests...");

try {
  // Test 1: escapeXML formatting
  assert.strictEqual(
    EPUBBuilder.escapeXML("Hello & World < > \" '"),
    "Hello &amp; World &lt; &gt; &quot; &apos;"
  );
  console.log("✓ Test 1 Passed: escapeXML converts XML characters.");

  // Test 2: generateUUID format
  const uuid = EPUBBuilder.generateUUID();
  assert.ok(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(uuid));
  console.log("✓ Test 2 Passed: generateUUID outputs valid UUID v4.");

  // Test 3: sanitizeToXHTML clean XHTML conversion
  const htmlInput = '<p>Hello World<br>Image: <img src="blob:url" data-epub-src="images/img1.png"></p>';
  const expectedXHTML = '<p>Hello World<br />Image: <img src="images/img1.png" data-epub-src="images/img1.png" /></p>';
  const outputXHTML = EPUBBuilder.sanitizeToXHTML(htmlInput);
  assert.strictEqual(outputXHTML, expectedXHTML);
  console.log("✓ Test 3 Passed: sanitizeToXHTML outputs closed and validated XML tags.");

  // Test 4: wrapSentencesForKepub sentence parsing
  const content = "<p>Hello world. This is test sentence two!</p>";
  const wrapped = EPUBBuilder.wrapSentencesForKepub(content, 1);
  assert.ok(wrapped.includes('id="kobo.1.1"'));
  assert.ok(wrapped.includes('id="kobo.1.2"'));
  console.log("✓ Test 4 Passed: wrapSentencesForKepub splits and wraps sentences in koboSpan nodes.");

  console.log("\nAll CI tests passed successfully!");
  process.exit(0);
} catch (err) {
  console.error("\n❌ Test Suite Failed:", err);
  process.exit(1);
}

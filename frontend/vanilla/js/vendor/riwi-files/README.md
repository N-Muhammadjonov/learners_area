Local file readers

Tesseract.js/core 7.0.0 and PDF.js 5.6.205 are copied from the installed official packages. Package licenses and decoder/font licenses are retained alongside the files. OCR language models are from the official tesseract-ocr/tessdata_fast repository; model source URLs and original byte hashes are in ocr/lang/models.json. versions.json pins every vendored file.

Assets load only when a file is read. Images and PDF scans use in-browser OCR; original file bytes stay on the device except an explicit original-layout edit, which sends an at-most-3MB source to the authenticated same-origin export API. Extracted text is bounded, user-supplied data for this chat, not global knowledge. No third-party AI, uploaded-document execution or remote-URL reading is used.

Limits: four files, 20MB each, 60 PDF pages, 60000 extracted characters per file / 120000 combined. ZIP uploads are refused; DOCX internally uses the standard OOXML ZIP container. Preserving PDF layout supports literal replacements in eligible horizontal text objects, existing glyphs and available line width; unsupported spans offer a separate new text-based copy rather than concealing the original with a painted rectangle. DOCX edits preserve unaffected parts, styles, tables and images. Digital signatures and JavaScript-bearing PDFs are not rewritten.

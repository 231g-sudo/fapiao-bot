# FapiaoBot — Agent Guide

## Project Overview
Browser-only SaaS tool that extracts Chinese electronic invoice (PDF/OFD) data to Excel. No server — pure client-side processing. Distributed via 闲鱼 for 19.9 RMB.

## Key Files
- **index.html** — main page; activation via `?code=XXX` or free tier (3 invoices/device)
- **app.js** — core engine (600+ lines): PDF parsing via pdf.js, OFD via ofd.js, position-based field extraction, table/export
- **admin.html** — activation code generator (password: `fapiao888`)
- **gen_codes.py** — CLI for batch code generation: `python3 gen_codes.py [N]`
- **pro.html** — legacy pro page (keep for existing links)

## Architecture
- **Zero server**: GitHub Pages static hosting; all logic in browser
- **PDF parsing**: pdf.js (`pdfjsLib`) — extracts text items with (x, y) coordinates
- **Line grouping**: group items with Y-tolerance ≤ 4px; offset each page by `(page-1)*2000` to prevent inter-page merging
- **Field extraction**: position-aware label→value matching (labels and values at different X positions)
- **Items (商品信息)**: detect table rows between "项目名称" header and "合计" line; product name x<200, quantity 250<x<350
- **Excel export**: SheetJS (`XLSX`) — 11 columns + totals row
- **Anti-piracy**: FingerprintJS device fingerprinting + localStorage for free limit; activation code validation with obfuscated JS (`_s()`/`_v()`)

## Testing
- Python simulation (`fitz`/PyMuPDF) in `__pycache__/` dev scripts mirrors JS algorithm exactly
- 7 sample invoices in `/home/clpc-yang-admin/workspace/测试发票/`
- To test: `python3 -c "..."` with PyMuPDF + same extraction logic as app.js

## Conventions
- Chinese variable names / comments in JS for context clues
- Activation codes: `FP-XXXXX-XXXXX` format; `gen_codes.py` must match JS `_s()` (verified via Node.js)
- OFD files detected by extension; parsed with `ofd.js` + `jszip`
- No build step — plain JS, deploy by pushing to main branch (GitHub Pages auto-deploys)

## Common Issues
- pdf.js vs PyMuPDF group items differently; always verify in browser after Python simulation
- Multi-page invoices: each page's 合计 appears on first page via overlay; need to handle duplicate 合计 lines
- X-position thresholds (x<200, 250<x<350) tuned for test invoices; may need adjustment for other formats

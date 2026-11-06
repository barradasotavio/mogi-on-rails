# Third-party notices

The capture grid, name normalization, weighted edit distance and global assignment concepts in `src/recognition/recognize.ts`, and the Lounge submission contract in `src/domain/scoring/submission.ts` with reference outputs in `tests/fixtures/lt-submissions.json`, are adapted from [PFQNiet/mkw-lounge-tracker](https://github.com/PFQNiet/mkw-lounge-tracker), commit 4f0bce33404c734b6d3125b9e3ee4ac9da28d434 (`src/ocr.js`, `src/player.js`, `src/capture.js`, `src/ui/export-results-dialog.js`).

MIT License

Copyright (c) 2025 Niet.dev

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## PaddleOCR browser recognition

Recognition uses the official PaddleOCR.js 0.4.2 SDK and PP-OCRv6 Tiny models (Small only for comparison builds) from PaddlePaddle (Apache-2.0), OpenCV.js (Apache-2.0), and ONNX Runtime Web 1.24.3 (MIT). Pinned model revisions and SHA-256 are retained in `packages/engine/scripts/paddle-models.json`. Preparation distributes the retained PaddleOCR/ONNX licenses from `packages/engine/licenses` and the installed OpenCV license in `/ocr`, including the offline inventory.

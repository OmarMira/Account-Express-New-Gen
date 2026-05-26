import { parsePDF } from './pdf-parser';

self.onmessage = async (e: MessageEvent<{ buffer: Uint8Array }>) => {
  try {
    const result = await parsePDF(Buffer.from(e.data.buffer));
    self.postMessage({ success: true, data: result });
  } catch (error) {
    self.postMessage({ success: false, error: String(error) });
  }
};

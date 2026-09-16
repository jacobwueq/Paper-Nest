import { compactLayout } from "./compaction.js?v=0.5.1";
let offset = 0;
self.onmessage = ({ data }) => {
  try {
    const result = compactLayout(data.parts, data.placements, data.settings, {
      milliseconds: 1800,
      startOffset: offset,
      onImprove: (result) =>
        self.postMessage({ type: "compacted", run: data.run, ...result }),
    });
    offset = result.nextOffset || 0;
    self.postMessage({ type: "complete", run: data.run, ...result });
  } catch (error) {
    self.postMessage({ type: "error", run: data.run, message: error.message });
  }
};

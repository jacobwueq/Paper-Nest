import { compactLayout } from "./compaction.js?v=0.33.1";
let offset = 0;
let jobs = 0;
let pairOffset = 0;
let clusterOffset = 0;
let dockOffset = 0;
self.onmessage = ({ data }) => {
  try {
    const result = compactLayout(data.parts, data.placements, data.settings, {
      milliseconds: 1800,
      startOffset: offset,
      pairOffset,
      clusterOffset,
      dockOffset,
      groupOnly: ++jobs % 3 === 0,
      onImprove: (result) =>
        self.postMessage({ type: "compacted", run: data.run, ...result }),
    });
    offset = result.nextOffset || 0;
    pairOffset = result.nextPairOffset || 0;
    clusterOffset = result.nextClusterOffset || 0;
    dockOffset = result.nextDockOffset || 0;
    self.postMessage({ type: "complete", run: data.run, ...result });
  } catch (error) {
    self.postMessage({ type: "error", run: data.run, message: error.message });
  }
};

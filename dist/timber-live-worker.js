import { planTimber } from './timber-planner.js?v=0.17.0';
self.onmessage = ({ data }) => {
  try { self.postMessage({ revision: data.revision, plan: planTimber(data.project) }); }
  catch (error) { self.postMessage({ revision: data.revision, error: error.message }); }
};

import { planTimber, optimizeTimber } from './timber-planner.js?v=0.29.0';
const endpoint = self;
let active = 0;
endpoint.onmessage = async ({ data }) => {
  const job = ++active;
  if (data.cancel) return;
  try {
    const initial = planTimber(data.project);
    endpoint.postMessage({ revision: data.revision, plan: initial, optimizing: true });
    const best = await optimizeTimber(data.project, {
      initialPlan: data.initialPlan || initial,
      budgetMs: data.budgetMs ?? 1200,
      maxTrials: (data.budgetMs || 0) > 1500 ? 1500 : 256,
      shouldCancel: () => job !== active,
      onProgress: (plan) => { if (job === active) endpoint.postMessage({ revision: data.revision, plan, optimizing: true }); },
    });
    if (job === active && best) endpoint.postMessage({ revision: data.revision, plan: best, optimizing: false });
  } catch (error) {
    if (job === active) endpoint.postMessage({ revision: data.revision, error: error.message, optimizing: false });
  }
};

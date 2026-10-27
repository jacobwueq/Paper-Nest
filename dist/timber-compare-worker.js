import { planTimber } from './timber-planner.js?v=0.31.2';
// Roadmap 2.7: plan the same list for a panel saw, off the main thread, so Review can
// say how many steps the table saw adds and why.
self.onmessage = ({ data }) => {
  try {
    const plan = planTimber({ ...data.project, settings: { ...data.project.settings, saw: 'panel' } });
    self.postMessage({ key: data.key, sheets: plan.sheets.length, steps: plan.fitness.cutCount, unplaced: plan.unplaced.length });
  } catch (error) { self.postMessage({ key: data.key, error: error.message }); }
};

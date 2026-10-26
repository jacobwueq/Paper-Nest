// Timber project settings: the one place where each setting's default, range and
// validation live. Planning code validates with it, the page reads, cleans and renders
// with it, and the sample project starts from its defaults. No DOM, no wording beyond
// the planner's error messages.
//
// required — validateTimberSettings throws when the value is missing.
// when     — the setting only exists for some settings (hybridLimit only for hybrid);
//            cleanTimberSettings leaves it out otherwise, as saved files always have.
const RANGE_MM = 'Kerf and edge trim must be between 0 and 100 mm.';
export const TIMBER_SETTINGS = [
  { key: 'kerf', type: 'number', default: 3.2, min: 0, max: 100, required: true, error: RANGE_MM },
  { key: 'trim', type: 'number', default: 5, min: 0, max: 100, required: true, error: RANGE_MM },
  { key: 'direction', type: 'choice', default: 'auto', choices: ['auto', 'rip', 'cross'], required: true, error: 'Choose a valid cutting direction.' },
  { key: 'saw', type: 'choice', default: 'panel', choices: ['panel', 'table', 'hybrid'], error: 'Choose a panel saw, a table saw or hybrid.' },
  { key: 'hybridLimit', type: 'number', default: 1220, min: 100, max: 10000, when: (s) => s.saw === 'hybrid', error: 'The table-saw piece length must be between 100 and 10,000 mm.' },
  { key: 'rotate', type: 'boolean', default: true, error: 'Project rotation and grain values must be true or false.' },
  { key: 'usePriorities', type: 'boolean', default: false, error: 'Part priorities must be enabled or disabled.' },
];
const FIELD = new Map(TIMBER_SETTINGS.map((f) => [f.key, f]));

const wellTyped = (f, v) => f.type === 'number' ? Number.isFinite(v) : f.type === 'boolean' ? typeof v === 'boolean' : f.choices.includes(v);
export const validSetting = (f, v) => wellTyped(f, v) && (f.type !== 'number' || (v >= f.min && v <= f.max));

// Throws the field's message for the first missing required value or invalid value.
export function validateTimberSettings(settings) {
  if (!settings || typeof settings !== 'object') throw new Error(RANGE_MM);
  for (const f of TIMBER_SETTINGS) {
    const v = settings[f.key];
    if (v === undefined ? f.required : !validSetting(f, v)) throw new Error(f.error);
  }
}

// The value the planner should use: the stored one, or the default when it is missing.
export function settingValue(settings, key) {
  const f = FIELD.get(key), v = settings?.[key];
  return wellTyped(f, v) ? v : f.default;
}

// A tidy settings object in the saved-file order. Well-typed values are kept even when
// out of range, so a draft with a typing mistake reopens as typed and the planner
// reports it; missing or wrongly typed values take the default.
export function cleanTimberSettings(settings = {}) {
  const out = {};
  for (const f of TIMBER_SETTINGS) out[f.key] = settingValue(settings, f.key);
  for (const f of TIMBER_SETTINGS) if (f.when && !f.when(out)) delete out[f.key];
  return out;
}

export const defaultTimberSettings = () => cleanTimberSettings({});

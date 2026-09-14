/**
 * Preset category tags offered in the Mod Browser filter bar.
 * CKAN tags are free-form strings (matched case-insensitively by
 * `GET /api/v1/mods?tag=`), so these presets are a UX shortcut —
 * users can always type an arbitrary tag into the custom field.
 */
export const POPULAR_MOD_TAGS: readonly string[] = [
  "Parts",
  "Gameplay",
  "Graphics",
  "Science",
  "Utility",
  "Plugin",
  "Config",
];

export const MOD_BROWSER_PAGE_SIZE = 25;

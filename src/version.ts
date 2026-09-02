import packageJson from '../package.json';

/** Build-visible semantic version sourced from package.json so exported evidence
 * cannot silently drift from the package version maintained by the project. */
export const KONTA2R_VERSION = packageJson.version;

/**
 * Public methodology contract carried with Community aggregates. Increment this
 * only when the meaning of published measurements changes, independently from
 * ordinary application release versions.
 */
export const KONTA2R_METHODOLOGY_VERSION = '2.0' as const;

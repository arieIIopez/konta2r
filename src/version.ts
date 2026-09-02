import packageJson from '../package.json';

/** Build-visible semantic version sourced from package.json so exported evidence
 * cannot silently drift from the package version maintained by the project. */
export const KONTA2R_VERSION = packageJson.version;

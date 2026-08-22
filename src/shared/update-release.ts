import semver from "semver";

export const BZ_GAMES_GITHUB_REPOSITORY =
  "https://github.com/baozha2023/bz-games";

const LATEST_RELEASE_URL = `${BZ_GAMES_GITHUB_REPOSITORY}/releases/latest`;

export function buildDesktopReleaseUrl(version?: string): string {
  const normalizedVersion = version?.trim().replace(/^v/i, "");
  const parsedVersion = normalizedVersion ? semver.parse(normalizedVersion) : null;
  if (
    !parsedVersion ||
    parsedVersion.prerelease.length > 0 ||
    parsedVersion.build.length > 0
  ) {
    return LATEST_RELEASE_URL;
  }

  return `${BZ_GAMES_GITHUB_REPOSITORY}/releases/tag/v${parsedVersion.version}`;
}

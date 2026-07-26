export const SITE = "https://markdownpreview.app";
export const REPO_URL = "https://github.com/pluk-inc/markdown-preview";
export const RELEASES_URL = `${REPO_URL}/releases`;
export const ISSUES_URL = `${REPO_URL}/issues`;

// Direct DMG download — assumes every release uploads `Markdown-Preview.dmg`
// (versionless filename). GitHub redirects this URL to the asset on the release
// currently marked "latest".
export const DOWNLOAD_URL = `${RELEASES_URL}/latest/download/Markdown-Preview.dmg`;

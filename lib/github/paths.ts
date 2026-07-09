/** Encode each path segment but keep the slashes (GitHub Contents API expects a path). */
export function encodeContentsPath(path: string): string {
  return path
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/')
}

import { normalizeRoutePath } from './path-utils.mjs';

export function routeFile(input, routes) {
  const pathname = normalizeRoutePath(input);
  for (const route of routes) {
    if (pathname.endsWith(String(route.extension).toLowerCase())) return route.handler;
  }
  return null;
}

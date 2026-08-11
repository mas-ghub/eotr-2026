export type RouteName = 'lineup' | 'timetable' | 'myday' | 'artist' | 'chat' | 'map' | 'print-program' | 'print-schedule' | 'notfound';

export interface Route {
  name: RouteName;
  slug?: string;
}

export function parseRoute(hash: string): Route {
  const clean = hash.replace(/^#\/?/, '').split('?')[0];
  const parts = clean.split('/').filter(Boolean);
  switch (parts[0]) {
    case '':
    case 'lineup':
      return { name: 'lineup' };
    case 'timetable':
      return { name: 'timetable' };
    case 'myday':
      return { name: 'myday' };
    case 'chat':
      return { name: 'chat' };
    case 'map':
      return { name: 'map' };
    case 'artist':
      return parts[1] ? { name: 'artist', slug: parts[1] } : { name: 'lineup' };
    case 'print':
      return parts[1] === 'schedule' ? { name: 'print-schedule' } : { name: 'print-program' };
    default:
      return { name: 'notfound' };
  }
}

export function navigate(hash: string) {
  if (location.hash === hash) {
    onRouteChange();
  } else {
    location.hash = hash;
  }
}

type RouteListener = (route: Route) => void;
const listeners = new Set<RouteListener>();
export let currentRoute: Route = parseRoute(location.hash);

export function onRoute(fn: RouteListener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function onRouteChange() {
  currentRoute = parseRoute(location.hash);
  listeners.forEach((fn) => fn(currentRoute));
}

window.addEventListener('hashchange', onRouteChange);

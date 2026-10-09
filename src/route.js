import { useEffect, useState } from 'react';

// Minimal hash router: #/page/param?query  →  { page, param, query }
function parse(hash) {
  const raw = hash.replace(/^#\/?/, '');
  const [path, qs = ''] = raw.split('?');
  const [page = '', param] = path.split('/').filter(Boolean);
  return { page, param, query: new URLSearchParams(qs) };
}

export function useHashRoute() {
  const [route, setRoute] = useState(() => parse(window.location.hash));
  useEffect(() => {
    const onChange = () => setRoute(parse(window.location.hash));
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}

export const navigate = (to) => { window.location.hash = to; };

// Update the URL without adding a history entry or triggering a route change.
export const replaceRoute = (to) => window.history.replaceState(null, '', to);

import { useEffect } from 'react';
import { OwnerEntry } from './OwnerEntry';
import { PublicApp } from './features/public/PublicApp';

export function Entry() {
  const home = window.location.pathname === '/';
  useEffect(() => {
    if (!home && window.location.pathname + window.location.search + window.location.hash !== '/BOSS') window.history.replaceState(null, '', '/BOSS');
  }, [home]);
  return home ? <PublicApp /> : <OwnerEntry />;
}

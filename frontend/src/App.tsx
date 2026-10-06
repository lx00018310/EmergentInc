import {worldsEnabled,selectedWorld} from './api/worldScope';
import {WorldEngine} from './features/engine/WorldEngine';
import React, { useEffect, useState } from 'react';
import { QianJiHall } from './features/hall/QianJiHall';
import { EngineView } from './features/engine/EngineView';
import { GachaView } from './features/gacha/GachaView';
import { MeetingView } from './features/meetings/MeetingView';

const HALL_PATH = '/QIAN';
const ENGINE_PATH = '/YUAN';

// 招募与会议是千机阁内的临时视图，不占用独立路径。
const viewFromPath = (pathname: string): 'hall' | 'engine' =>
  (pathname.split('/')[1]?.toLowerCase() ?? '') === 'yuan' ? 'engine' : 'hall';

export const App: React.FC = () => {
  const [route, setRoute] = useState<'hall' | 'engine'>(() => viewFromPath(window.location.pathname));
  const [aux, setAux] = useState<'gacha' | 'meeting' | null>(null);
  const [selectedQianjiId, setSelectedQianjiId] = useState<string | null>(null);
  const [selectedPixelId, setSelectedPixelId] = useState<string | null>(null);

  useEffect(() => {
    const canonical = viewFromPath(window.location.pathname) === 'engine' ? ENGINE_PATH : HALL_PATH;
    if (window.location.pathname !== canonical) window.history.replaceState(null, '', canonical+window.location.search);
    const onPopState = () => setRoute(viewFromPath(window.location.pathname));
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const openRoute = (next: 'hall' | 'engine') => {
    setRoute(next);
    setAux(null);
    const path = next === 'engine' ? ENGINE_PATH+(worldsEnabled()&&selectedWorld()?'?world='+encodeURIComponent(selectedWorld()!):'') : HALL_PATH;
    if (window.location.pathname !== path) window.history.pushState(null, '', path);
  };

  if (route === 'engine') {
    if(worldsEnabled())return <WorldEngine onBack={()=>openRoute('hall')}/>;
    return <EngineView onBack={() => openRoute('hall')} initialPixelId={selectedPixelId} onSelectedPixelChange={setSelectedPixelId} />;
  }
  if (aux === 'gacha') return <GachaView onBack={() => setAux(null)}
    onOpenPerson={id => { setSelectedQianjiId(id); setAux(null); }} />;
  if (aux === 'meeting') return <MeetingView onBack={() => setAux(null)} />;
  return <QianJiHall selectedQianjiId={selectedQianjiId} onSelectedQianji={setSelectedQianjiId}
    onSelectedPixel={setSelectedPixelId} onOpenEngine={() => openRoute('engine')}
    onOpenGacha={() => setAux('gacha')} onOpenMeeting={worldsEnabled()?undefined:()=>setAux('meeting')} />;
};

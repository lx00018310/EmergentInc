import React, { useState } from 'react';
import { TianJiHall } from './features/hall/TianJiHall';
import { EngineView } from './features/engine/EngineView';
import { GachaView } from './features/gacha/GachaView';
import { MeetingView } from './features/meetings/MeetingView';

export const App: React.FC = () => {
  const [view, setView] = useState<'hall' | 'engine' | 'gacha' | 'meeting'>('hall');
  const [selectedQianjiId, setSelectedQianjiId] = useState<string | null>(null);
  const [selectedPixelId, setSelectedPixelId] = useState<string | null>(null);

  if (view === 'engine') {
    return <EngineView onBack={() => setView('hall')} initialPixelId={selectedPixelId} onSelectedPixelChange={setSelectedPixelId} />;
  }
  if (view === 'gacha') return <GachaView onBack={() => setView('hall')}
    onOpenPerson={id => { setSelectedQianjiId(id); setView('hall'); }} />;
  if (view === 'meeting') return <MeetingView onBack={() => setView('hall')} />;
  return <TianJiHall selectedQianjiId={selectedQianjiId} onSelectedQianji={setSelectedQianjiId}
    onSelectedPixel={setSelectedPixelId} onOpenEngine={() => setView('engine')}
    onOpenGacha={() => setView('gacha')} onOpenMeeting={() => setView('meeting')} />;
};

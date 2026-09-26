import React, { useState } from 'react';
import { TianJiHall } from './features/hall/TianJiHall';
import { EngineView } from './features/engine/EngineView';
import { OrganizationDesk } from './features/organization/OrganizationDesk';

export const App: React.FC = () => {
  const [view, setView] = useState<'hall' | 'engine' | 'organization'>('hall');
  const [selectedQianjiId, setSelectedQianjiId] = useState<string | null>(null);
  const [selectedPixelId, setSelectedPixelId] = useState<string | null>(null);

  if (view === 'engine') {
    return <EngineView onBack={() => setView('hall')} initialPixelId={selectedPixelId} onSelectedPixelChange={setSelectedPixelId} />;
  }
  if (view === 'organization') return <OrganizationDesk onBack={() => setView('hall')} />;
  return <TianJiHall selectedQianjiId={selectedQianjiId} onSelectedQianji={setSelectedQianjiId}
    onSelectedPixel={setSelectedPixelId} onOpenEngine={() => setView('engine')} onOpenOrganization={() => setView('organization')} />;
};

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React from 'react';
import { expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { ToolCatalog } from '../src/features/tools/ToolCatalog';
import { fetchToolsCatalog } from '../src/api/tools';
import { setLanguage } from '../src/i18n';
import { en } from '../src/i18n/en';
vi.mock('../src/api/tools',()=>({fetchToolsCatalog:vi.fn()}));

it('renders the actual new maintenance tool descriptions in English and Chinese',async()=>{
  const source=readFileSync(resolve(__dirname,'../../apps/server/src/services/owner_work_service.ts'),'utf8');
  const definitions=['LIST_RELEASE_VERSIONS','ROLLBACK_RELEASE','DELETE_RELEASE'].map(name=>({name,description:source.match(new RegExp("register\\('"+name+"','([^']*)'"))![1],enabled:true,effect:'write',input_schema:{}}));
  vi.mocked(fetchToolsCatalog).mockResolvedValue({tools:definitions} as any);setLanguage('en');
  render(<ToolCatalog isOpen onClose={vi.fn()} onLogMessage={vi.fn()}/>);
  for(const tool of definitions)expect(await screen.findByText(en[tool.description])).toBeTruthy();
  act(()=>setLanguage('zh-CN'));for(const tool of definitions)expect(screen.getByText(tool.description)).toBeTruthy();
});

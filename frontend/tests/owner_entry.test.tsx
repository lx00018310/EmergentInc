import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {cleanup,render,screen,fireEvent,waitFor} from '@testing-library/react';
import {Entry} from '../src/Entry';
import {setLanguage} from '../src/i18n';
vi.mock('../src/features/boss/BossConsole',()=>({BossConsole:()=> <h2>Authenticated Boss</h2>}));
vi.mock('../src/features/public/PublicApp',()=>({PublicApp:()=> <h1>Public store</h1>}));
const response=(value:unknown)=>new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}});
beforeEach(()=>setLanguage('en'));
afterEach(()=>{cleanup();vi.restoreAllMocks();localStorage.clear();sessionStorage.clear();setLanguage('en');window.history.replaceState(null,'','/');});
it.each(['/BOSS','/boss/','/OWNER?goal=old#owner-dashboard','/owner/','/QIAN','/yuan/','/GENE?view=life'])('canonicalizes %s and protects all company state behind login',async path=>{
  window.history.replaceState(null,'',path);localStorage.setItem('emergentinc.ownerChat.draft','old private draft');const fetcher=vi.spyOn(globalThis,'fetch').mockResolvedValue(response({authenticated:false,mode:'boss'}));render(<Entry/>);
  await screen.findByRole('heading',{name:'Sign in to your company'});await waitFor(()=>expect(window.location.pathname+window.location.search+window.location.hash).toBe('/BOSS'));
  expect(screen.queryByText('Authenticated Boss')).toBeNull();expect(localStorage.getItem('emergentinc.ownerChat.draft')).toBeNull();expect(fetcher.mock.calls.map(([url])=>String(url))).toEqual(['/api/session']);
});
it('uses server-validated credentials before mounting the Boss page',async()=>{
  window.history.replaceState(null,'','/BOSS');const fetcher=vi.spyOn(globalThis,'fetch').mockImplementation(async input=>response({authenticated:String(input)==='/api/login',mode:'boss'}));render(<Entry/>);
  const button=await screen.findByRole('button',{name:'Log in'});fireEvent.change(screen.getByLabelText('Owner secret'),{target:{value:'fixture owner credential'}});fireEvent.submit(button.closest('form')!);
  await screen.findByText('Authenticated Boss');expect(JSON.parse(String(fetcher.mock.calls[1][1]?.body))).toEqual({secret:'fixture owner credential'});
});
it('keeps the storefront public without requesting company state',()=>{
  const fetcher=vi.spyOn(globalThis,'fetch');render(<Entry/>);expect(screen.getByRole('heading',{name:'Public store'})).toBeTruthy();expect(fetcher).not.toHaveBeenCalled();
});

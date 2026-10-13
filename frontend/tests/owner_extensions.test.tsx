import {afterEach,it,expect,vi} from 'vitest';
import {act,cleanup,fireEvent,render,screen} from '@testing-library/react';
import {OwnerExtensions} from '../src/features/owner/OwnerExtensions';
import {setLanguage,t} from '../src/i18n';
afterEach(()=>{cleanup();vi.restoreAllMocks();setLanguage('en');});
it.each(['en','zh-CN'] as const)('shows scoped extension provenance and performs an exact disable in %s',async language=>{
 setLanguage(language);let enabled=true;const hash='a'.repeat(64),fetch=vi.spyOn(globalThis,'fetch').mockImplementation(async(_url,options)=>{if(options?.method==='POST')enabled=false;return {ok:true,status:200,headers:new Headers({'content-type':'application/json'}),json:async()=>({items:[{id:'customer-analysis',worldId:'world_A',revision:3,hash,previousHash:null,enabled,requestedEnabled:enabled,reason:null,versions:[{hash,version:'1.0.0',creatorPixelId:'0_0_0',engine:'pure-ast-json@1',requiredContracts:['pure_skill@1'],reason:null}]}]})} as Response;});
 const {container}=render(<OwnerExtensions worldIds={['world_A']}/>);await act(async()=>{const details=container.querySelector('details')!;details.open=true;fireEvent(details,new Event('toggle'));});expect(await screen.findByText('customer-analysis')).toBeTruthy();expect(screen.getByText('1.0.0',{exact:false}).textContent).toContain('0_0_0');
 await act(async()=>fireEvent.click(screen.getByRole('button',{name:t('Disable extension')})));const request=fetch.mock.calls.find(([,o])=>o?.method==='POST')!;expect(request[0]).toBe('/api/worlds/world_A/extensions/customer-analysis/actions');expect(JSON.parse(String(request[1]!.body))).toMatchObject({action:'disable',expectedRevision:3,expectedHash:hash});expect(await screen.findByText(t('Extension disabled'),{exact:false})).toBeTruthy();
});

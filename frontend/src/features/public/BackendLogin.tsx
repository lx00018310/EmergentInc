import {useState} from 'react';
import {businessApi} from '../business/business_api';
import {t,useLanguage} from '../../i18n';

/** The server validates the existing env secret; it is never included in the frontend bundle. */
export function BackendLogin({onClose,onAuthenticated=()=>window.location.assign('/OWNER')}:{onClose:()=>void;onAuthenticated?:()=>void}){
  useLanguage();
  const [secret,setSecret]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  return <div className="public-dialog-backdrop"><section className="public-dialog" role="dialog" aria-modal="true" aria-labelledby="backend-login-title">
    <h2 id="backend-login-title">{t('Backend login')}</h2><p>{t('Enter the instance Owner secret to open OWNER.')}</p>
    {error&&<p role="alert">{error}</p>}
    <form onSubmit={async e=>{e.preventDefault();setBusy(true);setError('');try{await businessApi('login',{secret});setSecret('');onAuthenticated();}
      catch(err){setError((err as Error).message);}finally{setBusy(false);}}}>
      <label>{t('Owner 口令')}<input type="password" autoComplete="current-password" autoFocus required value={secret} onChange={e=>setSecret(e.target.value)}/></label>
      <div className="public-actions"><button className="public-primary" disabled={busy}>{t(busy?'登录中…':'登录')}</button>
        <button type="button" disabled={busy} onClick={onClose}>{t('Close')}</button></div>
    </form>
  </section></div>;
}

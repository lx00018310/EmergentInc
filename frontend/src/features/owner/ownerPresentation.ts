import { language,t } from '../../i18n';
export function ownerTime(value:number|string|null|undefined):string {
  if(value===null||value===undefined||value==='')return t('Time not recorded.');
  const date=new Date(value);if(!Number.isFinite(date.getTime()))return t('Time not recorded.');
  return new Intl.DateTimeFormat(language(),{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(date);
}
export function ownerStatusLabel(code:string,prefix=''):string {const key=prefix+code,label=t(key);return label!==key?label:t(code);}

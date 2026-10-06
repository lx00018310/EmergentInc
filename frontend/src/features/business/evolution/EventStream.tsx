import { t as tr, useLanguage } from '../../../i18n';
import { eventTitle, lifeTime, type LifeEvent } from './life_types';
import { StateBadge } from './LayerHeader';

const layers = { get ROOT() { return tr("信任根"); }, get GENOME() { return tr("基因"); }, get EVOLUTION() { return tr("进化"); }, get BODY() { return tr("身体"); } };
export function EventStream({ events, empty }: { events: LifeEvent[]; empty: string }) {
  useLanguage();
  if (!events.length) return <p>{empty}</p>;
  return <ol className="life-events">{events.slice(0, 20).map(event => <li key={event.id}>
    <div><time dateTime={new Date(event.time).toISOString()}>{lifeTime(event.time)}</time>
      <small>{layers[event.layer]} · {event.generation}</small><StateBadge state={event.state} /></div>
    <strong>{eventTitle(event)}</strong>{event.detail && <p>{event.detail}</p>}
  </li>)}</ol>;
}

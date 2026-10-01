import { lifeTime, type LifeEvent } from './life_types';
import { StateBadge } from './LayerHeader';

const layers = { ROOT: '信任根', GENOME: '基因', EVOLUTION: '进化', BODY: '身体' };
export function EventStream({ events, empty }: { events: LifeEvent[]; empty: string }) {
  if (!events.length) return <p>{empty}</p>;
  return <ol className="life-events">{events.slice(0, 20).map(event => <li key={event.id}>
    <div><time dateTime={new Date(event.time).toISOString()}>{lifeTime(event.time)}</time>
      <small>{layers[event.layer]} · {event.generation}</small><StateBadge state={event.state} /></div>
    <strong>{event.title}</strong>{event.detail && <p>{event.detail}</p>}
  </li>)}</ol>;
}

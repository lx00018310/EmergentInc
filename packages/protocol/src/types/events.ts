import { TraceContext } from "./trace.js";

/**
 * 运行时 Hook 事件名称
 */
export type RuntimeEventName =
  | "run:start"
  | "run:end"
  | "round:start"
  | "round:end"
  | "agent:step:start"
  | "agent:step:end"
  | "model:before"
  | "model:after"
  | "tool:before"
  | "tool:after"
  | "effect:before"
  | "effect:after";

/**
 * 运行时事件
 */
export interface RuntimeEvent<T = any> {
  eventName: RuntimeEventName;
  timestamp: number;
  trace: TraceContext;
  payload: T;
}

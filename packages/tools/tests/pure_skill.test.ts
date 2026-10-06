import {describe,it,expect} from 'vitest';
import {runPureSkill,compilePureSkill} from '../src/business/pure_skill.js';
describe('JSON-only AST code execution, with no JavaScript source evaluation',()=>{
  it('runs newly generated code, callbacks, lexical functions and conditional logic',()=>{
    expect(runPureSkill('export default input=>({count:input.rows.length,sum:input.rows.reduce((s,r)=>s+r.amount,0)})',{rows:[{amount:2},{amount:4}]})).toEqual({count:2,sum:6});
    expect(runPureSkill('export default x=>{const values=x.filter(v=>v>0); return values.length ? values.map(v=>Math.round(v)).join(",") : "empty"}',[-1,2.1,4.8])).toBe('2,5');
  });
  it.each(['export default x=>process.env','export default x=>require("fs")','export default x=>fetch("https://example.com")',
    'export default x=>x.constructor','export default x=>x["__proto__"]','export default x=>new Function("return process")()',
    'export default async x=>x','import fs from "fs"; export default x=>x'])('rejects host access and unsupported syntax: %s',source=>{
    expect(()=>runPureSkill(source,{})).toThrow();
  });
  it('limits recursion and rejects non-JSON output and object accessors without invoking them',()=>{
    expect(()=>runPureSkill('export default x=>{const f=n=>f(n+1);return f(1)}',{})).toThrow(/LIMIT/);
    expect(()=>runPureSkill('export default x=>()=>1',{})).toThrow('JSON_VALUE');
    let called=false;const value={get secret(){called=true;return 1;}};expect(()=>runPureSkill('export default x=>x',value)).toThrow('PROPERTY');expect(called).toBe(false);
    expect(()=>compilePureSkill('export default x=>x; export const other=1')).toThrow();
  });
  it('bounds repeated-reference output and refuses implicit recursive array coercion',()=>{
    const repeated='export default input=>{let a=[input];'+Array.from({length:25},()=> 'a=[a,a];').join('')+'return a}';
    expect(()=>runPureSkill(repeated,'value')).toThrow(/LIMIT/);
    expect(()=>runPureSkill(repeated.replace('return a}','return a.join("")}'),'value')).toThrow('JOIN_SCALAR');
    expect(()=>runPureSkill(repeated.replace('return a}','return a+""}'),'value')).toThrow('SCALAR_OPERAND');
  });
});

// Development-only fixture. All chat and language storage below is in memory, isolated from the browser's saved data.
import ReactDOM from 'react-dom/client';
import { OwnerChat } from '../src/features/owner/OwnerChat';
import { LanguageSwitch, language, t, useLanguage } from '../src/i18n';
import '../src/features/owner/owner.css';
import '../src/styles/index.css';

const chinese = (new URLSearchParams(location.search).get('lang') ?? language()) === 'zh-CN';
const values = new Map<string, string>([['emergentinc.language', chinese ? 'zh-CN' : 'en']]);
Object.defineProperty(window, 'localStorage', { configurable: true, value: {
  getItem: (key: string) => values.get(key) ?? null,
  setItem: (key: string, value: string) => { values.set(key, String(value)); },
  removeItem: (key: string) => { values.delete(key); },
  clear: () => values.clear(), key: (index: number) => Array.from(values.keys())[index] ?? null,
  get length() { return values.size; },
} satisfies Storage });
localStorage.setItem('emergentinc.ownerChat.history', JSON.stringify([
  { role: 'user', content: chinese ? '请汇总项目进展，以及需要我处理的事项。' : 'Summarize project progress and what needs my attention.' },
  { role: 'assistant', content: chinese ?
    '## 进展摘要\n\n- **已交付**：调研文档已提交，等待验收。\n- **需跟进**：设计任务等待素材。\n\n| 任务 | 负责人 | 状态 |\n| --- | --- | --- |\n| 调研文档 | 研究员 | 待验收 |\n| 首页设计 | 设计师 | 等待素材 |\n\n这是一组视觉验收样例，不代表实际公司执行结果。' :
    '## Progress summary\n\n- **Delivered**: research submitted for acceptance.\n- **Needs follow-up**: design awaits source material.\n\n| Task | Assignee | Stage |\n| --- | --- | --- |\n| Research | Researcher | Awaiting acceptance |\n| Homepage design | Designer | Awaiting materials |\n\nThis visual verification fixture does not represent company execution results.',
    as_of: '2026-10-15T07:00:00Z', sources: ['Visual verification fixture / 视觉验收样例'], usage: { tokens: 120, cost_cny: 0 } },
]));
function Review() {
  useLanguage();
  return <div className="owner-entry">
  <div className="owner-language"><LanguageSwitch/><span>视觉验收样例 / Visual verification fixture</span></div>
  <main className="owner-console"><section className="owner-page owner-page--chat">
    <h1>{t('Boss chat')}</h1><OwnerChat missionControl/></section></main>
</div>;
}
ReactDOM.createRoot(document.getElementById('root')!).render(<Review/>);

import { memo, useId } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { t, useLanguage } from '../../i18n';
import './owner-markdown.css';

export const OwnerMarkdown = memo(function OwnerMarkdown({ content }: { content: string }) {
  useLanguage();
  const id = useId().replace(/:/g, '');
  return <div className="owner-chat-content owner-chat-markdown">
    <Markdown remarkPlugins={[remarkGfm]} skipHtml
      remarkRehypeOptions={{ clobberPrefix: `owner-md-${id}-`, footnoteLabel: t('脚注'), footnoteBackLabel: t('返回引用') }}
      components={{
        a: ({ node: _node, ...props }) => <a {...props} {...(props.href?.startsWith('#') ? {} : { target: '_blank', rel: 'noopener noreferrer' })} />,
        table: ({ children }) => <div className="owner-markdown-table"><table>{children}</table></div>,
        img: ({ src, alt }) => src ? <a href={src} target="_blank" rel="noopener noreferrer">{alt || src}</a> : <span>{alt}</span>,
      }}>{content}</Markdown>
  </div>;
});

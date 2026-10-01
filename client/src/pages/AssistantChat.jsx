import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { useResource } from '../data.js';
import { Page, State } from '../ui.jsx';

const INTRO = 'I am the AIRO assistant. Ask me about a connection, WhatsApp, or this workspace.';

function pieces(line) {
  const parts = [];
  const pattern = /\*\*(.+?)\*\*/g;
  let last = 0;
  let match = pattern.exec(line);
  while (match) {
    if (match.index > last) parts.push(line.slice(last, match.index));
    parts.push({ strong: match[1] });
    last = match.index + match[0].length;
    match = pattern.exec(line);
  }
  if (last < line.length) parts.push(line.slice(last));
  return parts;
}

function Inline({ text }) {
  return pieces(text).map((part, index) => (
    typeof part === 'string' ? <span key={index}>{part}</span> : <strong key={index}>{part.strong}</strong>
  ));
}

function blocks(raw) {
  const lines = String(raw || '').replace(/\r/g, '').split('\n');
  const out = [];
  let list = null;
  function flush() {
    if (list) out.push(list);
    list = null;
  }
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      flush();
      continue;
    }
    const note = trimmed.match(/^\(?note:?\s*(.+)\)?$/i);
    if (note) {
      flush();
      out.push({ type: 'note', text: note[1].replace(/\)\s*$/, '') });
      continue;
    }
    const numbered = trimmed.match(/^\d+[.)]\s+(.+)/);
    if (numbered) {
      if (!list || list.type !== 'ol') {
        flush();
        list = { type: 'ol', items: [] };
      }
      list.items.push({ text: numbered[1], children: [] });
      continue;
    }
    const bullet = trimmed.match(/^[-*]\s+(.+)/);
    if (bullet && list?.type === 'ol' && list.items.length) {
      list.items[list.items.length - 1].children.push(bullet[1]);
      continue;
    }
    if (bullet) {
      if (!list || list.type !== 'ul') {
        flush();
        list = { type: 'ul', items: [] };
      }
      list.items.push(bullet[1]);
      continue;
    }
    flush();
    out.push({ type: 'p', text: trimmed });
  }
  flush();
  return out;
}

function MessageBody({ text, mine }) {
  if (mine) return <p><Inline text={text} /></p>;
  return blocks(text).map((block, index) => {
    if (block.type === 'p') return <p key={index}><Inline text={block.text} /></p>;
    if (block.type === 'note') return <p className="assistant-note" key={index}><Inline text={block.text} /></p>;
    if (block.type === 'ul') {
      return (
        <ul key={index}>
          {block.items.map((item, itemIndex) => <li key={itemIndex}><Inline text={item} /></li>)}
        </ul>
      );
    }
    return (
      <ol key={index}>
        {block.items.map((item, itemIndex) => (
          <li className="assistant-step" key={itemIndex}>
            <b>{itemIndex + 1}</b>
            <div>
              <Inline text={item.text} />
              {item.children.length ? (
                <ul>
                  {item.children.map((child, childIndex) => <li key={childIndex}><Inline text={child} /></li>)}
                </ul>
              ) : null}
            </div>
          </li>
        ))}
      </ol>
    );
  });
}

export function AssistantChat({ manageModels = false, onOpenModels }) {
  const state = useResource('/api/assistant');
  const assistant = state.data?.connected ? state.data : null;
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const endRef = useRef(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [messages, busy]);

  async function send(event) {
    event.preventDefault();
    const content = text.trim();
    if (!content || busy) return;
    const next = [...messages, { role: 'user', content }];
    setMessages(next);
    setText('');
    setBusy(true);
    setError('');
    try {
      const result = await api.post('/api/assistant/chat', { messages: next });
      setMessages((items) => [...items, { role: 'assistant', content: result.reply }]);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <State loading={state.loading} error={state.error} onRetry={state.reload}>
      {!assistant ? (
        <>
          <p>{state.data?.note || 'The platform assistant is not connected yet.'}</p>
          {manageModels ? <button className="btn" type="button" onClick={onOpenModels}>Open AI Models</button> : null}
        </>
      ) : (
        <div className="assistant-chat">
          <header>
            <span className="assistant-mark" aria-hidden="true">A</span>
            <span>
              <strong>{assistant.providerName}</strong>
              <em>{assistant.model}</em>
            </span>
          </header>
          <div className="assistant-thread">
            <div className="assistant-row">
              <span className="assistant-who" aria-hidden="true">AI</span>
              <div className="assistant-card">
                <p>{INTRO}</p>
              </div>
            </div>
            {messages.map((message, index) => {
              const mine = message.role === 'user';
              return (
                <div className={mine ? 'assistant-row mine' : 'assistant-row'} key={index}>
                  <span className="assistant-who" aria-hidden="true">{mine ? 'Y' : 'AI'}</span>
                  <div className="assistant-card">
                    <MessageBody text={message.content} mine={mine} />
                  </div>
                </div>
              );
            })}
            {busy ? (
              <div className="assistant-row">
                <span className="assistant-who" aria-hidden="true">AI</span>
                <div className="assistant-card" aria-label="Writing">
                  <span className="assistant-dots"><i /><i /><i /></span>
                </div>
              </div>
            ) : null}
            <div ref={endRef} />
          </div>
          <form className="assistant-compose" onSubmit={send}>
            <textarea
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder="Message the assistant"
              aria-label="Message"
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }}
            />
            <button className="btn-primary" type="submit" disabled={busy || !text.trim()}>Send</button>
            {error ? <p className="delta-down">{error}</p> : null}
          </form>
        </div>
      )}
    </State>
  );
}

export function AssistantPage() {
  return (
    <Page eyebrow="Assistant" title="Assistant" lede="Every role can talk to the platform assistant, from the workspace or from the platform.">
      <AssistantChat />
    </Page>
  );
}

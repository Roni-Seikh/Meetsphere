import { Send, X } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { ChatMessage } from '../../hooks/useMeetingRoom';

interface Props {
  messages: ChatMessage[];
  selfId: string;
  onSend: (body: string) => Promise<{ ok: boolean; error?: string }>;
  onClose: () => void;
}

const time = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

export function ChatPanel({ messages, selfId, onSend, onClose }: Props) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  // Scroll to the latest message whenever a new one arrives.
  useEffect(() => {
    endRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'end' });
  }, [messages.length]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim() || sending) return;
    setSending(true);
    const res = await onSend(text);
    setSending(false);
    if (res.ok) {
      setText('');
      setError(null);
    } else {
      setError(res.error ?? 'Message could not be sent.');
    }
  };

  return (
    <aside aria-label="Meeting chat" className="flex h-full w-full flex-col border-l border-slate-800 bg-slate-900 text-slate-100 sm:w-80">
      <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
        <h2 className="font-semibold">Chat</h2>
        <button onClick={onClose} aria-label="Close chat" className="rounded p-1 hover:bg-slate-800">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3" role="log" aria-live="polite">
        {messages.length === 0 ? (
          <p className="pt-8 text-center text-sm text-slate-400">No messages yet. Say hello!</p>
        ) : (
          messages.map((m) => {
            const mine = m.senderId === selfId;
            return (
              <div key={m.id} className={`flex flex-col ${mine ? 'items-end' : 'items-start'}`}>
                <span className="text-xs text-slate-400">
                  {mine ? 'You' : m.senderName} · {time(m.createdAt)}
                </span>
                {/* React escapes text, so message bodies can never inject HTML (XSS-safe). */}
                <p className={`mt-0.5 max-w-[90%] whitespace-pre-wrap break-words rounded-2xl px-3 py-1.5 text-sm ${mine ? 'bg-indigo-600' : 'bg-slate-800'}`}>{m.body}</p>
              </div>
            );
          })
        )}
        <div ref={endRef} />
      </div>
      <form onSubmit={submit} className="border-t border-slate-800 p-3">
        {error && (
          <p role="alert" className="mb-2 text-xs text-red-400">
            {error}
          </p>
        )}
        <div className="flex gap-2">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={2000}
            placeholder="Send a message"
            aria-label="Message"
            className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-indigo-500 focus:ring-0"
          />
          <button type="submit" disabled={!text.trim() || sending} aria-label="Send message" className="rounded-lg bg-indigo-600 px-3 text-white hover:bg-indigo-500 disabled:opacity-40">
            <Send className="h-4 w-4" />
          </button>
        </div>
      </form>
    </aside>
  );
}

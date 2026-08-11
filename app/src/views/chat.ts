import { h, icon, toast } from '../ui';
import { onViewCleanup } from '../lifecycle';
import { getName, promptForName } from '../greeting';
import {
  chatStart,
  chatMessages,
  chatStatus,
  isConfigured,
  onChatMessages,
  onChatStatus,
  sendMessage,
  markChatSeen,
  type ChatMessage,
  type ChatStatus
} from '../chat';

const MSG_LIMIT = 280;

function timeAgo(ts: number): string {
  try {
    const diff = Date.now() - ts;
    if (diff < 0) return 'now';
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    if (days < 7) return `${days}d ago`;
    return new Date(ts).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  } catch {
    return '';
  }
}

function statusLabel(s: ChatStatus): { text: string; cls: string } {
  switch (s.state) {
    case 'not-configured':
      return { text: 'Chat is coming soon', cls: 'off' };
    case 'connecting':
      return { text: 'Connecting…', cls: 'conn' };
    case 'online':
      return { text: `Live · ${s.count} message${s.count === 1 ? '' : 's'}`, cls: 'on' };
    case 'offline':
      return { text: 'Offline — needs a connection', cls: 'off' };
    case 'error':
      return { text: 'Connection issue — retrying', cls: 'err' };
  }
}

function messageEl(msg: ChatMessage, mine: boolean): HTMLElement {
  return h(
    'div',
    { class: 'chat-msg' + (mine ? ' mine' : '') },
    h(
      'div',
      { class: 'chat-msg__head' },
      h('span', { class: 'chat-msg__name' }, msg.name),
      h('span', { class: 'chat-msg__time', dataset: { ts: String(msg.ts) } }, timeAgo(msg.ts))
    ),
    h('div', { class: 'chat-msg__bubble' }, msg.text)
  );
}

/** Connection-state + composer are hidden entirely when chat is not configured. */
export async function renderChat(): Promise<HTMLElement> {
  const me = (getName() || '').toLowerCase();
  const configured = isConfigured();
  chatStart();

  const root = h('div', { class: 'view chat-view' });

  const status = h('span', { class: 'chat-status' });
  const head = h(
    'header',
    { class: 'chat-head' },
    h('div', {},
      h('h2', { class: 'chat-title' }, 'Messages'),
      h('p', { class: 'chat-sub' }, 'One guestbook for everyone at the festival.')
    ),
    status
  );
  root.appendChild(head);

  const wall = h('div', { class: 'chat-wall', 'aria-live': 'polite' });
  const composer = h('div', { class: 'chat-composer' });
  root.appendChild(wall);
  root.appendChild(composer);

  const renderStatus = (s: ChatStatus) => {
    const { text, cls } = statusLabel(s);
    status.textContent = text;
    status.className = `chat-status ${cls}`;
  };
  renderStatus(chatStatus());

  const renderComposer = () => {
    const name = getName();
    composer.innerHTML = '';
    if (!name) {
      composer.appendChild(
        h('button', {
          class: 'btn btn-primary chat-composer__setname',
          type: 'button',
          html: `${icon('chat', 15)} Set your name to post`
        })
      );
      composer.querySelector('.chat-composer__setname')!.addEventListener('click', () => {
        void promptForName().then((n) => {
          if (n) renderComposer();
        });
      });
      return;
    }
    const whoChip = h(
      'button',
      { class: 'chat-composer__who', type: 'button', title: 'Tap to change name' },
      h('span', { class: 'chat-composer__who-dot' }),
      `Posting as ${name}`
    );
    whoChip.addEventListener('click', () => {
      void promptForName(true).then(() => renderComposer());
    });
    const input = h('input', {
      class: 'chat-composer__input',
      type: 'text',
      maxlength: MSG_LIMIT,
      placeholder: 'Say hello…',
      autocomplete: 'off',
      'aria-label': 'Message'
    }) as HTMLInputElement;
    const send = h('button', { class: 'chat-composer__send', type: 'button', 'aria-label': 'Send', html: icon('send', 18) });
    const submit = async () => {
      const text = input.value.trim();
      if (!text) return;
      const ok = await sendMessage(name, text);
      if (ok) {
        input.value = '';
      } else {
        toast('Could not send. Check your connection.', { type: 'error' });
      }
    };
    send.addEventListener('click', () => void submit());
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        void submit();
      }
    });
    composer.appendChild(whoChip);
    composer.appendChild(input);
    composer.appendChild(send);
  };
  renderComposer();

  const renderWall = () => {
    const msgs = chatMessages();
    const nearBottom = wall.scrollHeight - wall.scrollTop - wall.clientHeight < 160;
    wall.innerHTML = '';
    if (!msgs.length) {
      wall.appendChild(
        h('div', { class: 'chat-empty' }, h('div', { class: 'chat-empty__icon', html: icon('chat', 30) }), h('p', {}, 'No messages yet — be the first to say hello!'))
      );
      return;
    }
    for (const m of msgs) {
      wall.appendChild(messageEl(m, me !== '' && m.name.toLowerCase() === me));
    }
    if (nearBottom || msgs[msgs.length - 1].name.toLowerCase() === me) {
      wall.scrollTop = wall.scrollHeight;
    }
  };

  const offChat = onChatMessages(renderWall);
  const offStatus = onChatStatus(renderStatus);
  const tick = setInterval(() => {
    wall.querySelectorAll('.chat-msg__time').forEach((el) => {
      const ts = Number((el as HTMLElement).dataset.ts || 0);
      el.textContent = timeAgo(ts);
    });
  }, 30000);

  if (configured) markChatSeen();
  renderWall();

  onViewCleanup(() => {
    offChat();
    offStatus();
    clearInterval(tick);
    markChatSeen();
  });

  return root;
}

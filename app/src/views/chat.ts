import { h, icon, toast, sheet } from '../ui';
import { onViewCleanup } from '../lifecycle';
import { getName, promptForName } from '../greeting';
import {
  chatStart,
  chatMessages,
  chatStatus,
  isConfigured,
  currentUid,
  currentAuth,
  onChatMessages,
  onChatStatus,
  onAuth,
  onConversations,
  listenConversation,
  conversations,
  conversationTitle,
  sendMessage,
  sendConversationMessage,
  openDm,
  createGroup,
  knownPeople,
  markChatSeen,
  markConversationSeen,
  type ChatMessage,
  type ChatStatus,
  type AuthState,
  type Conversation
} from '../chat';

const MSG_LIMIT = 280;

type Screen = { kind: 'wall' } | { kind: 'list' } | { kind: 'conv'; convId: string };

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
      return { text: `Live · ${s.count} on the wall`, cls: 'on' };
    case 'offline':
      return { text: 'Offline — needs a connection', cls: 'off' };
    case 'error':
      return { text: 'Connection issue — retrying', cls: 'err' };
  }
}

function messageEl(msg: ChatMessage, mine: boolean, onTapName?: (m: ChatMessage) => void): HTMLElement {
  const name = onTapName && msg.senderId && !mine
    ? h('button', { class: 'chat-msg__name chat-msg__name--tap', type: 'button', title: `Chat privately with ${msg.name}`, 'aria-label': `Chat privately with ${msg.name}` }, msg.name)
    : h('span', { class: 'chat-msg__name' }, msg.name);
  if (name.classList.contains('chat-msg__name--tap')) {
    name.addEventListener('click', () => {
      try {
        onTapName?.(msg);
      } catch (err) {
        console.error('chat name tap error', err);
        toast('Could not open that chat.', { type: 'error' });
      }
    });
  }
  return h(
    'div',
    { class: 'chat-msg' + (mine ? ' mine' : '') },
    h(
      'div',
      { class: 'chat-msg__head' },
      name,
      h('span', { class: 'chat-msg__time', dataset: { ts: String(msg.ts) } }, timeAgo(msg.ts))
    ),
    h('div', { class: 'chat-msg__bubble' }, msg.text)
  );
}

export async function renderChat(): Promise<HTMLElement> {
  const configured = isConfigured();
  if (!configured) {
    return h(
      'div',
      { class: 'view chat-view' },
      h(
        'div',
        { class: 'chat-empty' },
        h('div', { class: 'chat-empty__icon', html: icon('chat', 30) }),
        h('h2', {}, 'Chat is coming soon'),
        h('p', {}, 'The guestbook will appear here once it’s connected.')
      )
    );
  }
  chatStart();

  let screen: Screen = { kind: 'wall' };
  let auth: AuthState = currentAuth();

  const root = h('div', { class: 'view chat-view' });
  const status = h('span', { class: 'chat-status' });
  const headInner = h('div', {}, h('h2', { class: 'chat-title' }, 'Messages'), h('p', { class: 'chat-sub' }, 'One guestbook for everyone at the festival.'));
  const head = h('header', { class: 'chat-head' }, headInner, status);
  const seg = h('nav', { class: 'chat-seg', 'aria-label': 'Chat sections' });
  const body = h('div', { class: 'chat-body' });
  const composer = h('div', { class: 'chat-composer' });
  const authNote = h('div', { class: 'chat-authnote' });
  root.appendChild(head);
  root.appendChild(seg);
  root.appendChild(body);
  root.appendChild(authNote);
  root.appendChild(composer);

  const renderStatus = (s: ChatStatus) => {
    const { text, cls } = statusLabel(s);
    status.textContent = text;
    status.className = `chat-status ${cls}`;
  };
  renderStatus(chatStatus());

  const renderAuthNote = () => {
    if (auth === 'failed') {
      authNote.innerHTML = '';
      const note = h(
        'p',
        {},
        'Private chats are waiting for a one-time Firebase switch — ',
        h('button', { class: 'link', type: 'button' }, 'retry')
      );
      note.querySelector('button')!.addEventListener('click', () => chatStart());
      authNote.appendChild(note);
      authNote.classList.add('show');
    } else {
      authNote.classList.remove('show');
      authNote.innerHTML = '';
    }
  };
  renderAuthNote();

  // ---- segmented control (Everyone / Chats) ----
  const buildSeg = () => {
    seg.innerHTML = '';
    const inConv = screen.kind === 'conv';
    const convUnread = conversations().filter((c) => {
      try {
        const seen = Number(localStorage.getItem(`eotr2026.chat.seen.conv.v1.${c.id}`)) || 0;
        return c.lastAt > seen;
      } catch {
        return false;
      }
    }).length;
    const makeTab = (label: string, active: boolean, extra?: string) =>
      h(
        'button',
        { class: 'chat-seg__tab' + (active ? ' active' : ''), type: 'button' },
        label,
        extra ? h('span', { class: 'chat-seg__count' }, extra) : null
      );
    const tabWall = makeTab('Everyone', !inConv && screen.kind === 'wall');
    const tabChats = makeTab('Chats', !inConv && screen.kind === 'list', convUnread > 0 ? String(convUnread) : undefined);
    tabWall.addEventListener('click', () => {
      screen = { kind: 'wall' };
      buildSeg();
      renderScreen();
    });
    tabChats.addEventListener('click', () => {
      screen = { kind: 'list' };
      buildSeg();
      renderScreen();
    });
    seg.appendChild(tabWall);
    seg.appendChild(tabChats);
    seg.classList.toggle('hidden', inConv);
  };

  // ---- header for the current screen ----
  const buildHead = () => {
    headInner.innerHTML = '';
    const s = screen;
    if (s.kind === 'conv') {
      const back = h('button', { class: 'chat-back', type: 'button', 'aria-label': 'Back to chats', html: icon('arrowLeft', 18) });
      back.addEventListener('click', () => {
        screen = { kind: 'list' };
        buildSeg();
        buildHead();
        renderScreen();
      });
      const conv = conversations().find((c) => c.id === s.convId);
      headInner.appendChild(h('div', { class: 'chat-headrow' }, back, h('h2', { class: 'chat-title chat-title--conv' }, conv ? conversationTitle(conv) : 'Conversation')));
    } else {
      headInner.appendChild(h('h2', { class: 'chat-title' }, 'Messages'));
      headInner.appendChild(h('p', { class: 'chat-sub' }, 'One guestbook for everyone at the festival.'));
    }
  };

  // ---- message wall ----
  const renderWall = () => {
    body.classList.remove('chat-conv');
    body.classList.add('chat-wall');
    body.classList.add('show');
    const msgs = chatMessages();
    const nearBottom = body.scrollHeight - body.scrollTop - body.clientHeight < 160;
    body.innerHTML = '';
    if (!msgs.length) {
      body.appendChild(
        h('div', { class: 'chat-empty' }, h('div', { class: 'chat-empty__icon', html: icon('chat', 30) }), h('p', {}, 'No messages yet — be the first to say hello!'))
      );
    } else {
      const uid = currentUid();
      for (const m of msgs) {
        const mine = m.senderId ? m.senderId === uid : (getName() || '').toLowerCase() === m.name.toLowerCase();
        body.appendChild(messageEl(m, mine, tapName));
      }
    }
    if (msgs.length && (nearBottom || msgs[msgs.length - 1].senderId === currentUid())) {
      body.scrollTop = body.scrollHeight;
    }
  };

  async function tapName(msg: ChatMessage) {
    try {
      if (!msg.senderId) {
        toast('This message has no chat identity yet.', { type: 'info' });
        return;
      }
      if (!getName()) {
        await promptForName();
        if (!getName()) return;
      }
      console.log('[tapName] opening DM with', msg.senderId, msg.name, 'myUid', currentUid());
      const conv = await openDm(msg.senderId, msg.name);
      console.log('[tapName] openDm ->', conv ? conv.id : 'null');
      if (!conv) {
        toast('Could not start a chat. Check your connection.', { type: 'error' });
        return;
      }
      screen = { kind: 'conv', convId: conv.id };
      buildSeg();
      buildHead();
      renderScreen();
    } catch (err) {
      console.error('[tapName] error', err);
      toast('Could not open that chat.', { type: 'error' });
    }
  }

  // ---- conversation list ----
  const renderConvList = () => {
    body.classList.remove('chat-conv');
    body.classList.add('chat-wall', 'show');
    const list = conversations();
    body.innerHTML = '';
    const newBtn = h(
      'button',
      { class: 'btn btn-primary chat-newbtn', type: 'button', html: `${icon('chat', 15)} New chat` }
    );
    newBtn.addEventListener('click', () => openPicker());
    body.appendChild(newBtn);
    if (!list.length) {
      body.appendChild(
        h(
          'div',
          { class: 'chat-empty' },
          h('div', { class: 'chat-empty__icon', html: icon('chat', 30) }),
          h('p', {}, 'No chats yet. Tap a name on the Everyone wall, or start a new chat.'),
          h('p', { class: 'chat-empty__sub' }, 'New chats show up here.')
        )
      );
      return;
    }
    for (const c of list) {
      const unread = c.lastAt > (() => { try { return Number(localStorage.getItem(`eotr2026.chat.seen.conv.v1.${c.id}`)) || 0; } catch { return 0; } })() ? 1 : 0;
      const title = conversationTitle(c);
      const row = h(
        'button',
        { class: 'chat-conv-row' + (unread ? ' unread' : ''), type: 'button' },
        h('span', { class: 'chat-conv-row__avatar' }, (title[0] || '?').toUpperCase()),
        h('span', { class: 'chat-conv-row__mid' },
          h('span', { class: 'chat-conv-row__name' }, title, unread ? h('span', { class: 'chat-conv-row__dot' }) : null),
          h('span', { class: 'chat-conv-row__prev' }, c.lastText || (c.type === 'group' ? 'Group chat' : 'Say hello…'))
        ),
        h('span', { class: 'chat-conv-row__time' }, c.lastAt ? timeAgo(c.lastAt) : '')
      );
      row.addEventListener('click', () => {
        screen = { kind: 'conv', convId: c.id };
        buildSeg();
        buildHead();
        renderScreen();
      });
      body.appendChild(row);
    }
  };

  // ---- conversation screen ----
  let convUnsub: (() => void) | null = null;
  const renderConversation = (convId: string) => {
    body.classList.add('chat-conv');
    body.classList.remove('chat-wall');
    body.classList.add('show');
    body.innerHTML = '';
    const conv = conversations().find((c) => c.id === convId);
    if (!conv) {
      body.appendChild(h('div', { class: 'chat-empty' }, h('p', {}, 'This conversation is gone.')));
      return;
    }
    const uid = currentUid();
    const paint = (msgs: ChatMessage[]) => {
      const nearBottom = body.scrollHeight - body.scrollTop - body.clientHeight < 160;
      const wasScrolledDown = body.scrollTop + body.clientHeight >= body.scrollHeight - 40;
      body.innerHTML = '';
      if (!msgs.length) {
        body.appendChild(
          h('div', { class: 'chat-empty' }, h('div', { class: 'chat-empty__icon', html: icon('chat', 30) }), h('p', {}, 'No messages yet. Say hello!'))
        );
      } else {
        for (const m of msgs) {
          body.appendChild(messageEl(m, m.senderId === uid));
        }
      }
      if (nearBottom || wasScrolledDown) body.scrollTop = body.scrollHeight;
    };
    convUnsub?.();
    convUnsub = listenConversation(convId, paint);
    markConversationSeen(convId);
  };

  // ---- picker for a new chat ----
  function openPicker() {
    const people = knownPeople();
    if (!people.length) {
      toast('Say hello on the Everyone wall first, then you can chat with people.', { type: 'info', ms: 3600 });
      return;
    }
    const selected = new Set<string>();
    const titleInput = h('input', {
      class: 'chat-picker__title',
      type: 'text',
      maxlength: 40,
      placeholder: 'Group name (optional)',
      autocomplete: 'off',
      'aria-label': 'Group name'
    }) as HTMLInputElement;
    const goBtn = h('button', { class: 'btn btn-primary chat-picker__go', type: 'button', disabled: true, html: `${icon('send', 15)} Pick someone` }) as HTMLButtonElement;
    const updateGo = () => {
      const n = selected.size;
      goBtn.disabled = n === 0;
      goBtn.innerHTML = `${icon('send', 15)} ${n === 0 ? 'Pick someone' : n === 1 ? 'Start chat' : `Start group (${n})`}`;
    };

    const listWrap = h('div', { class: 'chat-picker__list' });
    for (const p of people) {
      const row = h(
        'button',
        { class: 'chat-picker__row', type: 'button', dataset: { uid: p.uid } },
        h('span', { class: 'chat-picker__check', html: icon('check', 14) }),
        h('span', {}, p.name)
      );
      row.addEventListener('click', () => {
        if (selected.has(p.uid)) selected.delete(p.uid);
        else selected.add(p.uid);
        row.classList.toggle('on', selected.has(p.uid));
        updateGo();
      });
      listWrap.appendChild(row);
    }

    const sheetBody = h('div', {}, titleInput, listWrap, goBtn);
    const closeSheet = sheet({ title: 'New chat', body: sheetBody });
    goBtn.addEventListener('click', async () => {
      const picked = people.filter((p) => selected.has(p.uid));
      if (!picked.length) return;
      let conv: Conversation | null = null;
      if (picked.length === 1) {
        conv = await openDm(picked[0].uid, picked[0].name);
      } else {
        const title = (titleInput.value || '').trim() || `Group · ${picked.length + 1}`;
        conv = await createGroup(title, picked);
      }
      closeSheet.close();
      if (conv) {
        screen = { kind: 'conv', convId: conv.id };
        buildSeg();
        buildHead();
        renderScreen();
      } else {
        toast('Could not start that chat. Check your connection.', { type: 'error' });
      }
    });
  }

  // ---- composer ----
  const renderComposer = () => {
    composer.innerHTML = '';
    const name = getName();
    const activeConv = screen.kind === 'conv' ? screen.convId : null;

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
      placeholder: activeConv ? 'Message…' : 'Say hello…',
      autocomplete: 'off',
      'aria-label': 'Message'
    }) as HTMLInputElement;
    const send = h('button', { class: 'chat-composer__send', type: 'button', 'aria-label': 'Send', html: icon('send', 18) });

    const submit = async () => {
      const text = input.value.trim();
      if (!text) return;
      const ok = activeConv
        ? await sendConversationMessage(activeConv, name, text)
        : await sendMessage(name, text);
      if (ok) {
        input.value = '';
      } else {
        toast(auth === 'failed' ? 'Private chats need Anonymous sign-in to be enabled in Firebase.' : 'Could not send. Check your connection.', { type: 'error', ms: 4200 });
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

  const renderScreen = () => {
    body.innerHTML = '';
    if (screen.kind === 'wall') renderWall();
    else if (screen.kind === 'list') renderConvList();
    else renderConversation(screen.convId);
    renderComposer();
  };

  // ---- subscriptions ----
  const offMessages = onChatMessages((msgs) => {
    if (screen.kind !== 'wall') return;
    const nearBottom = body.scrollHeight - body.scrollTop - body.clientHeight < 160;
    const uid = currentUid();
    body.innerHTML = '';
    if (!msgs.length) {
      body.appendChild(h('div', { class: 'chat-empty' }, h('div', { class: 'chat-empty__icon', html: icon('chat', 30) }), h('p', {}, 'No messages yet — be the first to say hello!')));
    } else {
      for (const m of msgs) {
        const mine = m.senderId ? m.senderId === uid : (getName() || '').toLowerCase() === m.name.toLowerCase();
        body.appendChild(messageEl(m, mine, tapName));
      }
    }
    if (msgs.length && (nearBottom || msgs[msgs.length - 1].senderId === uid)) body.scrollTop = body.scrollHeight;
  });
  const offConvs = onConversations((list) => {
    if (screen.kind === 'list') renderConvList();
    if (screen.kind === 'conv') {
      const s = screen;
      const conv = list.find((c) => c.id === s.convId);
      if (conv) {
        headInner.querySelector('.chat-title--conv')!.textContent = conversationTitle(conv);
      }
    }
  });
  const offStatus = onChatStatus(renderStatus);
  const offAuth = onAuth((s) => {
    auth = s;
    renderAuthNote();
  });

  buildSeg();
  buildHead();
  renderScreen();
  if (screen.kind === 'wall') markChatSeen();

  const tick = setInterval(() => {
    body.querySelectorAll('.chat-msg__time').forEach((el) => {
      const ts = Number((el as HTMLElement).dataset.ts || 0);
      el.textContent = timeAgo(ts);
    });
  }, 30000);

  onViewCleanup(() => {
    offMessages();
    offConvs();
    offStatus();
    offAuth();
    convUnsub?.();
    clearInterval(tick);
    markChatSeen();
    if (screen.kind === 'conv') markConversationSeen(screen.convId);
  });

  return root;
}

// --- Utilities ---
function fmtDate(val) {
  try {
    const d = new Date(val);
    if (!isNaN(d)) return d.toLocaleString();
  } catch {}
  return String(val || "");
}

function createEl(tag, opts = {}) {
  const el = document.createElement(tag);
  if (opts.className) el.className = opts.className;
  if (opts.text) el.textContent = opts.text;
  if (opts.html) el.innerHTML = opts.html;
  return el;
}

async function jsonGet(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status}`);
  return r.json();
}

async function jsonPost(url, body) {
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`${r.status}`);
  return r.json();
}

async function httpDelete(url) {
  const r = await fetch(url, { method: 'DELETE' });
  if (!r.ok) throw new Error(`${r.status}`);
  try { return await r.json(); } catch { return {}; }
}

function confirmAction(message) { return window.confirm(message); }

// --- Floating Nav (Back/Home) ---
function updateFloatingNav() {
  const backBtn = document.getElementById('navBack');
  const homeBtn = document.getElementById('navHome');
  if (!backBtn || !homeBtn) return;
  const raw = (location.hash || '#customers').toLowerCase();
  // Context-aware back target
  let backHash = '#customers';
  if (raw.startsWith('#workspaces/')) {
    const parts = raw.replace(/^#/, '').split('/');
    if (parts.length >= 4 && parts[2] === 'thread') backHash = `#workspaces/${parts[1]}`;
    else backHash = '#workspaces';
  } else if (raw.startsWith('#documents')) backHash = '#customers';
  backBtn.onclick = () => {
    // Prefer history back, fallback to computed hash
    if (window.history.length > 1) window.history.back();
    else location.hash = backHash;
  };
  homeBtn.onclick = () => { location.hash = '#workspaces'; };
}

// --- Routes ---
const routes = {
  customers: async () => {
    const container = document.createElement("div");
    container.innerHTML = `
      <div class="row" style="justify-content: space-between;">
        <h1>Customers</h1>
        <button id="addCustomerBtn" title="Create a demo customer">+ Add</button>
      </div>
      <div class="spacer"></div>
      <div class="card">
        <div class="muted">List of customers from the API (if running)</div>
        <div class="spacer"></div>
        <div id="customersList" class="list"></div>
      </div>
    `;

    // Try to load customers from backend API. It's okay if it fails.
    const list = container.querySelector("#customersList");
    list.textContent = "Loading...";
    try {
      const res = await fetch(`/api/customers`);
      if (!res.ok) throw new Error(`${res.status}`);
      const items = await res.json();
      if (!Array.isArray(items) || items.length === 0) {
        list.textContent = "No customers yet.";
      } else {
        list.textContent = "";
        items.forEach((c) => {
          const el = document.createElement("div");
          el.className = "item";
          el.textContent = `#${c.id} · ${c.name}`;
          list.appendChild(el);
        });
      }
    } catch (e) {
      list.textContent = "Could not load customers (API offline).";
      list.classList.add("muted");
    }

    container.querySelector("#addCustomerBtn").addEventListener("click", async () => {
      try {
        const name = prompt("Customer name", "Acme Corp");
        if (!name) return;
        const res = await fetch(`/api/customers`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name }),
        });
        if (res.ok) location.reload();
      } catch {}
    });

    return container;
  },

  documents: async () => {
    const container = document.createElement("div");
    container.innerHTML = `
      <h1>Documents</h1>
      <div class="spacer"></div>
      <div class="card">
        <div class="muted">Select a customer to view documents. For now, this is a placeholder.</div>
      </div>
    `;
    return container;
  },

  workspaces: async () => {
    const container = document.createElement("div");
    container.innerHTML = `
      <div class="row" style="justify-content: space-between; align-items: end; gap: 12px;">
        <div>
          <h1 style="margin: 0;">Workspaces</h1>
          <div class="muted">AnythingLLM connection required (configure API URL/Key)</div>
        </div>
        <div class="toolbar">
          <input class="input" id="newWsName" placeholder="New workspace name" />
          <button id="createWsBtn">Create</button>
          <button id="refreshWkBtn">Refresh</button>
        </div>
      </div>
      <div class="spacer"></div>
      <div class="card">
        <div id="wsStatus" class="muted">Loading workspaces…</div>
        <div class="spacer"></div>
        <div id="wsList" class="list"></div>
      </div>
    `;

    async function load() {
      const status = container.querySelector('#wsStatus');
      const list = container.querySelector('#wsList');
      status.textContent = 'Checking auth…';
      list.innerHTML = '';
      try {
        // Optional: check auth to give clearer error
        try {
          await jsonGet('/api/anythingllm/auth');
        } catch (e) {}

        status.textContent = 'Loading…';
        const data = await jsonGet('/api/anythingllm/workspaces');
        const items = Array.isArray(data) ? data : (Array.isArray(data?.workspaces) ? data.workspaces : []);
        if (!items.length) {
          status.textContent = 'No workspaces found.';
          return;
        }
        status.textContent = '';
        items.forEach(ws => {
          const el = createEl('div', { className: 'item' });
          const name = ws.name || ws.slug || '(unnamed)';
          const slug = ws.slug || (typeof ws.name === 'string' ? ws.name.toLowerCase().replace(/\s+/g,'-') : '');
          el.innerHTML = `<strong>${name}</strong>${slug ? ` <span class="muted">· ${slug}</span>` : ''}`;
          el.style.cursor = 'pointer';
          el.addEventListener('click', () => {
            if (slug) location.hash = `#workspaces/${encodeURIComponent(slug)}`;
          });
          list.appendChild(el);
        });
      } catch (e) {
        status.textContent = 'Failed to load workspaces. Check ANYTHINGLLM config.';
      }
    }

    container.querySelector('#refreshWkBtn').addEventListener('click', load);
    const createBtn = container.querySelector('#createWsBtn');
    if (createBtn) {
      createBtn.addEventListener('click', async () => {
        const input = container.querySelector('#newWsName');
        const name = (input?.value || '').trim();
        if (!name) return;
        try {
          await jsonPost('/api/anythingllm/workspace/new', { name });
          if (input) input.value = '';
          await load();
        } catch {}
      });
    }
    await load();
    return container;
  },

  workspaceDetail: async (slug, threadSlug) => {
    const container = document.createElement('div');
    container.innerHTML = `
      <div class="row" style="justify-content: space-between; align-items: end; gap: 12px;">
        <div>
            <div class="row" style="gap: 10px; align-items: baseline;">
              <a href="#workspaces" class="muted" style="text-decoration:none">Workspaces</a>
              <h1 style="margin: 0;" id="wsTitle">${slug}</h1>
            </div>
            <div class="muted">${threadSlug ? `Thread: ${threadSlug}` : 'Workspace overview'}</div>
            <div class="toolbar" style="margin-top:8px; gap: 8px;">
              <button id="renameWs">Rename</button>
              <button id="deleteWs">Delete</button>
            </div>
          </div>
          <div class="row" style="gap: 8px;">
            <label class="muted">Limit</label>
            <input id="limitInput" type="number" min="1" max="200" value="50" style="width:72px; background:#0f141a; color:#e8eef4; border:1px solid #26303b; border-radius:6px; padding:6px 8px;" />
            <select id="orderInput" style="background:#0f141a; color:#e8eef4; border:1px solid #26303b; border-radius:6px; padding:6px 8px;">
              <option value="desc" selected>Newest</option>
              <option value="asc">Oldest</option>
            </select>
            <button id="resetChat">Reset</button>
            <button id="reloadChats">Reload</button>
          </div>
      </div>
      <div class="spacer"></div>
      <div class="row" style="align-items: flex-start; gap: 16px;">
        <div style="flex:0 0 280px; max-width: 280px;">
          <div class="card">
            <div class="row" style="justify-content: space-between; align-items:center;">
              <strong>Threads</strong>
              <button id="newThreadBtn" title="Create thread">+ New</button>
            </div>
            <div class="spacer"></div>
            <div id="threadsList" class="list"></div>
          </div>
        </div>
        <div style="flex:1 1 auto; min-width:0;">
          <div id="summary" class="card muted">Loading chats…</div>
          <div class="spacer"></div>
          <div id="chats" class="list"></div>
          <div class="spacer"></div>
          <div class="card">
            <div class="toolbar" style="flex-direction: column; align-items: stretch; gap: 8px;">
              <textarea id="chatInput" class="textarea" placeholder="Type a message and press Send"></textarea>
              <div class="row" style="justify-content: flex-end; gap: 8px;">
                <label class="muted">Mode</label>
                <select id="chatMode" class="select">
                  <option value="chat" selected>Chat</option>
                  <option value="query">Query</option>
                </select>
                <label class="muted" style="display:${threadSlug ? 'inline-flex' : 'none'}; align-items:center; gap:6px;">
                  <input id="streamToggle" type="checkbox" ${threadSlug ? 'checked' : ''} /> Stream
                </label>
                <button id="sendChat">Send</button>
                <button id="stopStream" style="display:none;">Stop</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

    async function loadThreads(selectIfMissing = true) {
      const list = container.querySelector('#threadsList');
      list.innerHTML = '';
      try {
        const data = await jsonGet(`/api/anythingllm/workspace/${encodeURIComponent(slug)}`);
        const workspace = data?.workspace || (Array.isArray(data) ? data[0] : null) || data;
        const threads = Array.isArray(workspace?.threads) ? workspace.threads : [];
        if (!threads.length) {
          list.appendChild(createEl('div', { className: 'muted', text: 'No threads yet.' }));
          return;
        }
        threads.forEach(t => {
          const el = createEl('div', { className: 'item' });
          const name = t.name || t.slug || 'Thread';
          const tslug = t.slug || String(t.id || '');
          el.dataset.slug = tslug;
          el.dataset.name = name;
          el.innerHTML = `<strong>${name}</strong>${tslug ? ` <span class="muted">· ${tslug}</span>` : ''}`;
          el.style.cursor = 'pointer';
          if (tslug === threadSlug) el.classList.add('active');
          el.addEventListener('click', () => {
            if (tslug) location.hash = `#workspaces/${encodeURIComponent(slug)}/thread/${encodeURIComponent(tslug)}`;
          });
          list.appendChild(el);
          const actions = document.createElement('div');
          actions.className = 'actions';
          actions.style.marginTop = '6px';
          const rn = document.createElement('button'); rn.className = 'icon-btn'; rn.textContent = 'Rename';
          const del = document.createElement('button'); del.className = 'icon-btn'; del.textContent = 'Delete';
          rn.addEventListener('click', async (ev) => {
            ev.stopPropagation();
            const newName = prompt('New thread name', el.dataset.name || 'Thread');
            const slugVal = el.dataset.slug;
            if (!newName || !slugVal) return;
            try { await jsonPost(`/api/anythingllm/workspace/${encodeURIComponent(slug)}/thread/${encodeURIComponent(slugVal)}/update`, { name: newName }); await loadThreads(false); } catch {}
          });
          del.addEventListener('click', async (ev) => {
            ev.stopPropagation();
            const slugVal = el.dataset.slug;
            const nm = el.dataset.name || 'Thread';
            if (!slugVal) return;
            if (!confirmAction(`Delete thread "${nm}"?`)) return;
            try { await httpDelete(`/api/anythingllm/workspace/${encodeURIComponent(slug)}/thread/${encodeURIComponent(slugVal)}`); await loadThreads(); } catch {}
          });
          actions.appendChild(rn);
          actions.appendChild(del);
          el.appendChild(actions);
        });
        // If we have no thread selected, optionally pick first
        if (!threadSlug && selectIfMissing && threads[0]?.slug) {
          location.hash = `#workspaces/${encodeURIComponent(slug)}/thread/${encodeURIComponent(threads[0].slug)}`;
        }
      } catch (e) {
        list.appendChild(createEl('div', { className: 'muted', text: 'Failed to load threads.' }));
      }
    }

    async function loadChats() {
      const chatsEl = container.querySelector('#chats');
      const summary = container.querySelector('#summary');
      chatsEl.innerHTML = '';
      summary.textContent = 'Loading chats…';
      const limit = Number(container.querySelector('#limitInput').value) || 50;
      const orderBy = container.querySelector('#orderInput').value || 'desc';
      try {
        let items = [];
        if (threadSlug) {
          const data = await jsonGet(`/api/anythingllm/workspace/${encodeURIComponent(slug)}/thread/${encodeURIComponent(threadSlug)}/chats`);
          items = Array.isArray(data?.history) ? data.history : (Array.isArray(data) ? data : []);
        } else {
          const q = new URLSearchParams({ limit: String(limit), orderBy });
          const data = await jsonGet(`/api/anythingllm/workspace/${encodeURIComponent(slug)}/chats?${q}`);
          items = Array.isArray(data?.history) ? data.history : (Array.isArray(data?.chats) ? data.chats : (Array.isArray(data) ? data : []));
        }
        summary.textContent = `${items.length} chat${items.length === 1 ? '' : 's'} loaded`;
        if (!items.length) return;
        items.forEach((chat) => {
          const el = createEl('div', { className: 'item' });
          // For thread chats, common fields
          const ts = chat.createdAt || chat.timestamp || chat.created_at || chat.time || chat.sentAt;
          const who = chat.user || chat.sender || chat.role || '';
          const msg = chat.message || chat.text || chat.content || '';
          if (msg || who || ts) {
            el.innerHTML = `
              <div class="row" style="justify-content: space-between;">
                <div><strong>${who || 'Message'}</strong></div>
                <div class="muted">${fmtDate(ts)}</div>
              </div>
              <div class="spacer" style="height:6px"></div>
              <div style="white-space: pre-wrap;">${(String(msg)).slice(0, 2000)}</div>
            `;
          } else {
            el.textContent = JSON.stringify(chat);
          }
          chatsEl.appendChild(el);
        });
      } catch (e) {
        summary.textContent = 'Failed to load chats. Ensure API URL/Key are valid.';
      }
    }

    container.querySelector('#reloadChats').addEventListener('click', loadChats);
    container.querySelector('#newThreadBtn').addEventListener('click', async () => {
      const name = prompt('Thread name', 'Customer Intake');
      if (!name) return;
      try {
        await jsonPost(`/api/anythingllm/workspace/${encodeURIComponent(slug)}/thread/new`, { name });
        await loadThreads(false);
      } catch {}
    });

    container.querySelector('#sendChat').addEventListener('click', async () => {
      const input = container.querySelector('#chatInput');
      const mode = container.querySelector('#chatMode')?.value || 'chat';
      const stream = !!container.querySelector('#streamToggle')?.checked;
      const stopBtn = container.querySelector('#stopStream');
      const message = input.value.trim();
      if (!message) return;
      try {
        const chatsEl = container.querySelector('#chats');
        const userEl = createEl('div', { className: 'item' });
        userEl.innerHTML = `<div class="row" style="justify-content: space-between;"><div><strong>user</strong></div><div class="muted">${fmtDate(Date.now())}</div></div><div class="spacer" style="height:6px"></div><div style="white-space: pre-wrap;">${message}</div>`;
        chatsEl.appendChild(userEl);

        const body = { message, mode };
        const assistantEl = createEl('div', { className: 'item' });
        const header = `<div class="row" style="justify-content: space-between;"><div><strong>assistant</strong></div><div class="muted">${fmtDate(Date.now())}</div></div><div class="spacer" style="height:6px"></div>`;
        const content = createEl('div');
        content.style.whiteSpace = 'pre-wrap';
        assistantEl.innerHTML = header;
        assistantEl.appendChild(content);
        chatsEl.appendChild(assistantEl);
        input.value = '';

        // Streaming only for thread chats (server provides SSE for thread)
        if (threadSlug && stream) {
          let abortController = new AbortController();
          if (stopBtn) stopBtn.style.display = '';
          if (stopBtn) stopBtn.onclick = () => abortController.abort();

          const resp = await fetch(`/api/anythingllm/workspace/${encodeURIComponent(slug)}/thread/${encodeURIComponent(threadSlug)}/stream-chat`, {
            method: 'POST',
            headers: { 'Accept': 'text/event-stream', 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: abortController.signal,
          });
          if (!resp.ok || !resp.body) throw new Error(`${resp.status}`);
          const reader = resp.body.getReader();
          const decoder = new TextDecoder();
          let buffer = '';
          try {
            while (true) {
              const { value, done } = await reader.read();
              if (done) break;
              buffer += decoder.decode(value, { stream: true });
              const lines = buffer.split(/\r?\n/);
              buffer = lines.pop() || '';
              for (const line of lines) {
                if (!line) continue;
                if (line.startsWith('data:')) {
                  let data = line.slice(5).trimStart();
                  if (data === '[DONE]') continue;
                  // try parse JSON, else append raw
                  try {
                    const j = JSON.parse(data);
                    const piece = j?.text || j?.delta || j?.content || j?.textResponse || '';
                    if (piece) content.textContent += String(piece);
                  } catch {
                    content.textContent += data;
                  }
                }
              }
            }
          } finally {
            if (stopBtn) stopBtn.style.display = 'none';
          }
        } else {
          // Non-stream path
          let resp;
          if (threadSlug) {
            resp = await jsonPost(`/api/anythingllm/workspace/${encodeURIComponent(slug)}/thread/${encodeURIComponent(threadSlug)}/chat`, body);
          } else {
            resp = await jsonPost(`/api/anythingllm/workspace/${encodeURIComponent(slug)}/chat`, body);
          }
          const text = resp?.textResponse || resp?.response || JSON.stringify(resp);
          content.textContent = String(text).slice(0, 4000);
        }
      } catch (e) {
        alert('Failed to send chat.');
      }
    });

    container.querySelector('#resetChat').addEventListener('click', async () => {
      if (!confirmAction('Reset this conversation?')) return;
      try {
        const body = { reset: true };
        if (threadSlug) {
          await jsonPost(`/api/anythingllm/workspace/${encodeURIComponent(slug)}/thread/${encodeURIComponent(threadSlug)}/chat`, body);
        } else {
          await jsonPost(`/api/anythingllm/workspace/${encodeURIComponent(slug)}/chat`, body);
        }
        await loadChats();
      } catch {}
    });

    container.querySelector('#renameWs').addEventListener('click', async () => {
      const cur = container.querySelector('#wsTitle').textContent;
      const name = prompt('New workspace name', cur);
      if (!name) return;
      try { await jsonPost(`/api/anythingllm/workspace/${encodeURIComponent(slug)}/update`, { name }); location.hash = `#workspaces/${encodeURIComponent(slug)}`; } catch {}
    });
    container.querySelector('#deleteWs').addEventListener('click', async () => {
      if (!confirmAction('Delete this workspace? This may remove associated data.')) return;
      try { await httpDelete(`/api/anythingllm/workspace/${encodeURIComponent(slug)}`); location.hash = '#workspaces'; } catch {}
    });

    await loadThreads();
    await loadChats();
    return container;
  },
};

function setActive(hash) {
  document.querySelectorAll(".menu-item").forEach((a) => a.classList.remove("active"));
  const id = hash.replace("#", "");
  const link = document.getElementById(`nav-${id}`);
  if (link) link.classList.add("active");
}

async function render() {
  const view = document.getElementById("view");
  const raw = (location.hash || "#customers").toLowerCase();
  // Patterns: #customers, #documents, #workspaces, #workspaces/<slug>
  let route = raw.replace(/^#/, "");
  let args = [];
  if (route.startsWith('workspaces/')) {
    const parts = route.split('/');
    const slug = decodeURIComponent(parts[1] || '').trim();
    let threadSlug;
    if (parts[2] === 'thread') {
      threadSlug = decodeURIComponent(parts[3] || '').trim();
    }
    route = 'workspaceDetail';
    args = [slug, threadSlug];
    setActive('#workspaces');
  } else if (!routes[route]) {
    route = 'customers';
    setActive('#customers');
  } else {
    setActive(`#${route}`);
  }
  view.innerHTML = "";
  view.appendChild(await routes[route](...args));
  updateFloatingNav();
}

window.addEventListener("hashchange", render);
window.addEventListener("DOMContentLoaded", () => { updateFloatingNav(); render(); });

(() => {
  const state = {
    banks: [],
    activeBank: '',
    activeTab: 'overview'
  };

  const $ = (selector) => document.querySelector(selector);
  const content = $('#content');
  const bankSelect = $('#bankSelect');
  const bankCards = $('#bankCards');
  const health = $('#health');

  function fmtNumber(value) {
    if (value === null || value === undefined || Number.isNaN(Number(value))) return '—';
    return new Intl.NumberFormat().format(Number(value));
  }

  function fmtDate(value) {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleString();
  }

  function textSnippet(value, max = 520) {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    if (!text) return 'No text available.';
    return text.length > max ? `${text.slice(0, max).trim()}…` : text;
  }

  function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs || {})) {
      if (key === 'class') node.className = value;
      else if (key === 'text') node.textContent = value;
      else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
      else if (value !== false && value !== null && value !== undefined) node.setAttribute(key, String(value));
    }
    for (const child of children.flat()) {
      if (child === null || child === undefined) continue;
      node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
    }
    return node;
  }

  function rawDetails(value, label = 'Raw JSON') {
    return el('details', {},
      el('summary', { text: label }),
      el('pre', { text: JSON.stringify(value, null, 2) })
    );
  }

  async function api(path, options = {}) {
    const response = await fetch(path, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {})
      }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = data.message || data.error || `HTTP ${response.status}`;
      throw new Error(message);
    }
    return data;
  }

  function setLoading(message = 'Loading…') {
    content.replaceChildren(el('div', { class: 'empty-state', text: message }));
  }

  function setError(error) {
    content.replaceChildren(el('div', { class: 'empty-state' },
      el('strong', { text: 'Something failed' }),
      el('p', { class: 'muted', text: error.message || String(error) })
    ));
  }

  function setHealth(ok, text) {
    health.className = `status-pill ${ok ? 'ok' : 'bad'}`;
    health.textContent = text;
  }

  async function checkHealth() {
    try {
      const data = await api('/api/health');
      const healthy = data.hindsight && data.hindsight.status === 'healthy';
      setHealth(healthy, healthy ? 'Hindsight healthy' : 'Hindsight degraded');
    } catch (error) {
      setHealth(false, 'Hindsight unreachable');
    }
  }

  async function loadBanks() {
    const data = await api('/api/banks');
    state.banks = data.banks || [];
    if (!state.activeBank || !state.banks.some((bank) => bank.bank_id === state.activeBank)) {
      const preferred = state.banks.find((bank) => bank.bank_id === 'hermes-default') || state.banks[0];
      state.activeBank = preferred ? preferred.bank_id : '';
    }
    renderBankPicker();
    renderBankCards();
  }

  function renderBankPicker() {
    bankSelect.replaceChildren(...state.banks.map((bank) => {
      const option = el('option', { value: bank.bank_id, text: bank.bank_id });
      if (bank.bank_id === state.activeBank) option.selected = true;
      return option;
    }));
    bankSelect.disabled = state.banks.length === 0;
  }

  function renderBankCards() {
    if (!state.banks.length) {
      bankCards.replaceChildren(el('div', { class: 'empty-state', text: 'No banks found.' }));
      return;
    }
    bankCards.replaceChildren(...state.banks.map((bank) => {
      const stats = bank.stats || {};
      const card = el('button', {
        class: `bank-card ${bank.bank_id === state.activeBank ? 'active' : ''}`,
        type: 'button',
        onclick: () => {
          state.activeBank = bank.bank_id;
          bankSelect.value = state.activeBank;
          renderBankCards();
          loadActiveTab();
        }
      },
      el('h3', { text: bank.bank_id || bank.name || 'Unnamed bank' }),
      el('div', { class: 'metric-row' },
        metric('Docs', stats.total_documents ?? stats.documents ?? bank.document_count),
        metric('Facts', stats.total_nodes ?? bank.fact_count),
        metric('Failed', stats.failed_operations ?? 0)
      ),
      el('p', { class: 'muted small', text: `Last document: ${fmtDate(bank.last_document_at || stats.last_document_at)}` })
      );
      return card;
    }));
  }

  function metric(label, value) {
    return el('div', { class: 'metric' },
      el('strong', { text: fmtNumber(value) }),
      el('span', { text: label })
    );
  }

  function activeBankOrEmpty() {
    if (!state.activeBank) {
      content.replaceChildren(el('div', { class: 'empty-state', text: 'No active bank.' }));
      return '';
    }
    return state.activeBank;
  }

  async function loadOverview() {
    const bank = activeBankOrEmpty();
    if (!bank) return;
    setLoading();
    const [stats, tags] = await Promise.all([
      api(`/api/banks/${encodeURIComponent(bank)}/stats`),
      api(`/api/banks/${encodeURIComponent(bank)}/tags`).catch(() => null)
    ]);
    content.replaceChildren(
      el('div', { class: 'grid-2' },
        overviewPanel('Documents', stats.total_documents, 'Retained source documents in this bank.'),
        overviewPanel('Memory facts', stats.total_nodes, 'Extracted memory units/facts available for recall.'),
        overviewPanel('Links', stats.total_links, 'Graph links between facts/entities.'),
        overviewPanel('Pending ops', stats.pending_operations, 'Background operations still queued.'),
        overviewPanel('Failed ops', stats.failed_operations, 'Operations that need investigation.'),
        overviewPanel('Observations', stats.total_observations, 'Synthesized observations, if enabled.')
      ),
      tags ? el('section', { class: 'item-card', style: 'margin-top:14px' },
        el('h3', { text: 'Tags' }),
        el('p', { class: 'muted', text: Array.isArray(tags.tags) ? (tags.tags.join(', ') || 'No tags') : textSnippet(JSON.stringify(tags), 280) }),
        rawDetails(tags)
      ) : null,
      rawDetails(stats, 'Raw stats')
    );
  }

  function overviewPanel(title, value, help) {
    return el('div', { class: 'item-card' },
      el('h3', { text: title }),
      el('div', { class: 'metric' }, el('strong', { text: fmtNumber(value) })),
      el('p', { class: 'muted small', text: help })
    );
  }

  async function loadMemories() {
    const bank = activeBankOrEmpty();
    if (!bank) return;
    setLoading();
    const data = await api(`/api/banks/${encodeURIComponent(bank)}/memories?limit=30`);
    const items = data.items || data.memories || data.results || [];
    renderList('Recent memories', items, renderMemoryCard);
  }

  async function loadDocuments() {
    const bank = activeBankOrEmpty();
    if (!bank) return;
    setLoading();
    const data = await api(`/api/banks/${encodeURIComponent(bank)}/documents?limit=30`);
    const items = data.items || data.documents || [];
    renderList('Recent documents', items, renderDocumentCard);
  }

  async function loadOperations() {
    const bank = activeBankOrEmpty();
    if (!bank) return;
    setLoading();
    const statuses = ['failed', 'pending', 'processing', 'completed'];
    const results = await Promise.all(statuses.map(async (status) => {
      try {
        return [status, await api(`/api/banks/${encodeURIComponent(bank)}/operations?status=${status}&limit=12`)];
      } catch (error) {
        return [status, { error: error.message }];
      }
    }));
    content.replaceChildren(el('div', { class: 'item-list' }, ...results.map(([status, data]) => {
      const ops = data.operations || data.items || [];
      return el('section', { class: 'item-card' },
        el('div', { class: 'meta' }, el('span', { class: `pill ${status === 'failed' ? 'bad' : status === 'completed' ? 'ok' : 'pending'}`, text: status })),
        data.error ? el('p', { class: 'muted', text: data.error }) : null,
        ops.length ? el('div', { class: 'item-list' }, ...ops.map(renderOperationCard)) : el('p', { class: 'muted', text: `No ${status} operations.` })
      );
    })));
  }

  function renderOperationCard(op) {
    return el('div', { class: 'item-card' },
      el('p', { text: op.task_type || op.operation_type || op.id || 'Operation' }),
      el('div', { class: 'meta' },
        el('span', { text: `Status: ${op.status || 'unknown'}` }),
        el('span', { text: `Created: ${fmtDate(op.created_at)}` }),
        op.completed_at ? el('span', { text: `Completed: ${fmtDate(op.completed_at)}` }) : null
      ),
      op.error_message || op.error ? el('p', { class: 'muted small', text: textSnippet(op.error_message || op.error, 360) }) : null,
      rawDetails(op)
    );
  }

  function renderList(title, items, renderer) {
    content.replaceChildren(
      el('h2', { text: title }),
      items.length ? el('div', { class: 'item-list' }, ...items.map(renderer)) : el('div', { class: 'empty-state', text: 'Nothing found.' })
    );
  }

  function renderMemoryCard(item) {
    return el('article', { class: 'item-card' },
      el('p', { text: textSnippet(item.text || item.content || item.summary) }),
      el('div', { class: 'meta' },
        el('span', { text: item.fact_type || item.type || 'memory' }),
        el('span', { text: fmtDate(item.date || item.created_at || item.mentioned_at) }),
        item.id ? el('span', { text: `ID: ${item.id}` }) : null
      ),
      item.context ? el('p', { class: 'muted small', text: textSnippet(item.context, 260) }) : null,
      rawDetails(item)
    );
  }

  function renderDocumentCard(item) {
    return el('article', { class: 'item-card' },
      el('h3', { text: item.id || item.document_id || 'Document' }),
      el('div', { class: 'meta' },
        el('span', { text: `Created: ${fmtDate(item.created_at)}` }),
        el('span', { text: `Updated: ${fmtDate(item.updated_at)}` }),
        el('span', { text: `${fmtNumber(item.memory_unit_count)} memories` }),
        el('span', { text: `${fmtNumber(item.text_length)} chars` })
      ),
      item.original_text ? el('p', { text: textSnippet(item.original_text, 420) }) : null,
      rawDetails(item)
    );
  }

  function renderRecall() {
    const bank = activeBankOrEmpty();
    if (!bank) return;
    const query = el('textarea', { id: 'recallQuery', placeholder: 'Ask what this bank remembers…' });
    const budget = el('select', { id: 'recallBudget' },
      el('option', { value: 'low', text: 'low' }),
      el('option', { value: 'mid', text: 'mid' }),
      el('option', { value: 'high', text: 'high' })
    );
    budget.value = 'mid';
    const results = el('div', { id: 'recallResults', class: 'item-list' });
    const submit = el('button', { type: 'button', text: 'Recall', onclick: async () => {
      const q = query.value.trim();
      if (!q) {
        results.replaceChildren(el('div', { class: 'empty-state', text: 'Enter a query first.' }));
        return;
      }
      submit.disabled = true;
      results.replaceChildren(el('div', { class: 'empty-state', text: 'Searching memory…' }));
      try {
        const data = await api(`/api/banks/${encodeURIComponent(bank)}/recall`, {
          method: 'POST',
          body: JSON.stringify({ query: q, budget: budget.value, max_tokens: 3072, types: ['world', 'experience'] })
        });
        renderRecallResults(results, data);
      } catch (error) {
        results.replaceChildren(el('div', { class: 'empty-state', text: error.message }));
      } finally {
        submit.disabled = false;
      }
    }});
    content.replaceChildren(
      el('h2', { text: 'Recall search' }),
      el('div', { class: 'form-row' },
        query,
        el('div', { class: 'form-actions' }, el('label', { text: 'Budget' }), budget, submit)
      ),
      results
    );
  }

  function renderRecallResults(container, data) {
    const results = data.results || [];
    if (!results.length) {
      container.replaceChildren(el('div', { class: 'empty-state', text: 'No recall results.' }), rawDetails(data, 'Raw response'));
      return;
    }
    container.replaceChildren(...results.map((result, index) => {
      const text = typeof result === 'string' ? result : (result.text || result.content || result.summary || JSON.stringify(result));
      return el('article', { class: 'item-card' },
        el('div', { class: 'meta' }, el('span', { class: 'pill ok', text: `Result ${index + 1}` })),
        el('p', { text: textSnippet(text, 900) }),
        typeof result === 'object' ? rawDetails(result) : null
      );
    }), rawDetails(data, 'Full recall response'));
  }

  async function loadActiveTab() {
    try {
      if (state.activeTab === 'overview') return await loadOverview();
      if (state.activeTab === 'memories') return await loadMemories();
      if (state.activeTab === 'documents') return await loadDocuments();
      if (state.activeTab === 'recall') return renderRecall();
      if (state.activeTab === 'operations') return await loadOperations();
    } catch (error) {
      setError(error);
    }
  }

  function bindEvents() {
    $('#refreshButton').addEventListener('click', async () => {
      setLoading('Refreshing…');
      try {
        await checkHealth();
        await loadBanks();
        await loadActiveTab();
      } catch (error) {
        setError(error);
      }
    });
    bankSelect.addEventListener('change', () => {
      state.activeBank = bankSelect.value;
      renderBankCards();
      loadActiveTab();
    });
    document.querySelectorAll('.tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        state.activeTab = tab.dataset.tab;
        document.querySelectorAll('.tab').forEach((item) => item.classList.toggle('active', item === tab));
        loadActiveTab();
      });
    });
  }

  async function init() {
    bindEvents();
    setLoading('Connecting to Hindsight…');
    await checkHealth();
    await loadBanks();
    await loadActiveTab();
  }

  init().catch(setError);
})();

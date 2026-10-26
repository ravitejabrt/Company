// app.js - Multi-Role Client Logic for Prime User & Agents with Direct Supabase Support & Local Fallback

class CollectionApp {
  constructor() {
    this.currency = '₹';
    localStorage.setItem('nexus_currency', '₹');
    this.currentUser = JSON.parse(localStorage.getItem('nexus_user') || 'null');
    
    // Supabase Client Reference
    this.supabase = null;
    this.supabaseUrl = '';
    this.supabaseKey = '';

    // Prime Data
    this.stats = null;
    this.agentShare = [];
    this.companies = [];
    this.agents = [];
    this.collections = [];
    this.rewards = [];
    this.invoices = [];
    this.pieSlices = [];
    this.hoveredSliceIndex = -1;

    // Agent Portal Data
    this.agentData = null;

    // Realtime & Live Sync Infrastructure
    this.broadcastChannel = null;
    this.realtimeChannel = null;
    this.syncInterval = null;
    this._syncTimeout = null;

    this.init();
  }

  async init() {
    this.setupCurrencySelector();
    this.setupTabs();
    this.setupModals();
    this.setupForms();
    this.setupCanvasInteractivity();
    this.setupFilters();
    this.setupQuickButtons();
    this.setupSupabaseModal();
    this.setupSyncInfrastructure();

    window.addEventListener('resize', () => {
      if (this.currentUser?.role === 'prime') {
        this.drawPieChart();
      }
    });

    // Initialize Supabase if credentials exist in localStorage or URL query
    this.initSupabase();

    await this.loadAgentsForAuth();
    await this.checkDatabaseStatus();

    if (this.currentUser) {
      this.applyUserSession();
    } else {
      this.showLoginOverlay();
    }
  }

  // ====================================================================
  // SUPABASE CLIENT INITIALIZATION & STATUS
  // ====================================================================
  initSupabase() {
    // 1. Check if Supabase keys passed via URL params: ?supabase_url=...&supabase_key=...
    const urlParams = new URLSearchParams(window.location.search);
    const qUrl = urlParams.get('supabase_url');
    const qKey = urlParams.get('supabase_key');
    if (qUrl && qKey) {
      localStorage.setItem('nexus_supabase_url', qUrl.trim());
      localStorage.setItem('nexus_supabase_key', qKey.trim());
    }

    this.supabaseUrl = localStorage.getItem('nexus_supabase_url') || '';
    this.supabaseKey = localStorage.getItem('nexus_supabase_key') || '';

    if (window.supabase && this.supabaseUrl && this.supabaseKey) {
      try {
        this.supabase = window.supabase.createClient(this.supabaseUrl, this.supabaseKey);
        this.updateDbStatusUI(true, 'Supabase Cloud');
        console.log('[Supabase] Initialized direct client for:', this.supabaseUrl);
        this.setupSupabaseRealtime();
        return true;
      } catch (err) {
        console.error('[Supabase] Initialization error:', err);
        this.supabase = null;
      }
    }

    // Determine if on GitHub Pages or static host where Supabase is needed
    const host = window.location?.hostname || '';
    const isStaticHosted = host.includes('github.io') ||
      (!['localhost', '127.0.0.1'].includes(host) && window.location?.protocol !== 'http:');

    if (isStaticHosted && (!this.supabaseUrl || !this.supabaseKey)) {
      this.updateDbStatusUI(false, 'Supabase Required');
      // Prompt user to connect Supabase after brief animation
      setTimeout(() => {
        this.openSupabaseConfigModal();
      }, 700);
    } else {
      this.updateDbStatusUI(false, 'Local SQLite');
    }

    return false;
  }

  updateDbStatusUI(connected, text) {
    if (typeof window.updateDbStatusUI === 'function') {
      window.updateDbStatusUI(connected, text);
    }
  }

  openSupabaseConfigModal() {
    if (typeof window.openSupabaseConfigModal === 'function') {
      window.openSupabaseConfigModal();
    } else {
      const urlInput = document.getElementById('cfg-supabase-url');
      const keyInput = document.getElementById('cfg-supabase-key');
      if (urlInput) urlInput.value = localStorage.getItem('nexus_supabase_url') || '';
      if (keyInput) keyInput.value = localStorage.getItem('nexus_supabase_key') || '';
      this.openModal('modal-supabase-config');
    }
  }

  disconnectSupabase() {
    if (confirm('Clear Supabase credentials and disconnect database?')) {
      localStorage.removeItem('nexus_supabase_url');
      localStorage.removeItem('nexus_supabase_key');
      this.supabase = null;
      this.supabaseUrl = '';
      this.supabaseKey = '';
      this.updateDbStatusUI(false, 'Disconnected');
      this.closeModal('modal-supabase-config');
      this.showToast('Supabase connection cleared.');
      this.loadAgentsForAuth();
      if (this.currentUser) {
        if (this.currentUser.role === 'prime') this.refreshAllPrimeData();
        else this.refreshAgentData();
      }
    }
  }

  setupSupabaseModal() {
    const form = document.getElementById('form-supabase-config');
    if (!form) return;

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const url = document.getElementById('cfg-supabase-url').value.trim();
      const key = document.getElementById('cfg-supabase-key').value.trim();
      const saveBtn = document.getElementById('btn-save-supabase');

      if (!url || !key) {
        this.showToast('Please provide both Project URL and API Key', 'error');
        return;
      }

      if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.textContent = 'Connecting...';
      }

      try {
        if (!window.supabase) {
          throw new Error('Supabase client library not loaded. Check internet connection.');
        }

        const testClient = window.supabase.createClient(url, key);
        // Test query on agents table
        const { error } = await testClient.from('agents').select('id').limit(1);
        if (error) {
          throw new Error(`Database connection failed: ${error.message}. Ensure supabase_schema.sql was run in Supabase.`);
        }

        // Successfully verified connection
        localStorage.setItem('nexus_supabase_url', url);
        localStorage.setItem('nexus_supabase_key', key);
        this.supabaseUrl = url;
        this.supabaseKey = key;
        this.supabase = testClient;
        this.setupSupabaseRealtime();

        this.updateDbStatusUI(true, 'Supabase Cloud');
        this.closeModal('modal-supabase-config');
        this.showToast('⚡ Connected to Supabase Cloud Database successfully!');

        // Reload data
        await this.loadAgentsForAuth();
        if (this.currentUser) {
          if (this.currentUser.role === 'prime') {
            await this.refreshAllPrimeData();
          } else {
            await this.refreshAgentData();
          }
        }
      } catch (err) {
        console.error('Supabase connection error:', err);
        this.showToast(err.message, 'error');
      } finally {
        if (saveBtn) {
          saveBtn.disabled = false;
          saveBtn.textContent = 'Save & Connect Database';
        }
      }
    });
  }

  // ====================================================================
  // LIVE REALTIME SYNCHRONIZATION INFRASTRUCTURE
  // ====================================================================
  setupSyncInfrastructure() {
    // 1. Cross-Tab Live Synchronization via BroadcastChannel
    if (typeof BroadcastChannel !== 'undefined') {
      try {
        this.broadcastChannel = new BroadcastChannel('nexus_collections_sync');
        this.broadcastChannel.onmessage = (event) => {
          if (event.data && event.data.type === 'DATA_CHANGED') {
            this.handleLiveSync(event.data.entity);
          }
        };
      } catch (e) {
        console.warn('BroadcastChannel initialization skipped:', e);
      }
    }

    // 2. Cross-Tab Storage Event (Fallback for browsers without BroadcastChannel)
    window.addEventListener('storage', (e) => {
      if (e.key === 'nexus_sync_event') {
        this.handleLiveSync('storage');
      }
    });

    // 3. Tab Visibility Change (Auto-refresh on returning to tab)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && this.currentUser) {
        this.refreshCurrentUserData(true);
      }
    });

    // 4. Background Heartbeat Synchronization Loop (Every 8 seconds)
    if (this.syncInterval) clearInterval(this.syncInterval);
    this.syncInterval = setInterval(() => {
      if (this.currentUser && document.visibilityState === 'visible') {
        this.refreshCurrentUserData(true);
      }
    }, 8000);
  }

  // Subscribe to Supabase Realtime changes across all tables
  setupSupabaseRealtime() {
    if (!this.supabase || typeof this.supabase.channel !== 'function') return;
    try {
      if (this.realtimeChannel) {
        this.supabase.removeChannel(this.realtimeChannel);
      }
      this.realtimeChannel = this.supabase
        .channel('nexus-db-realtime-sync')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'invoices' }, () => this.handleLiveSync('invoices'))
        .on('postgres_changes', { event: '*', schema: 'public', table: 'collections' }, () => this.handleLiveSync('collections'))
        .on('postgres_changes', { event: '*', schema: 'public', table: 'companies' }, () => this.handleLiveSync('companies'))
        .on('postgres_changes', { event: '*', schema: 'public', table: 'agents' }, () => this.handleLiveSync('agents'))
        .on('postgres_changes', { event: '*', schema: 'public', table: 'rewards' }, () => this.handleLiveSync('rewards'))
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') {
            console.log('[Supabase Realtime] Connected to live database events!');
            this.setSyncStatus('⚡ Live Sync', false);
          }
        });
    } catch (err) {
      console.warn('[Realtime] Could not subscribe:', err.message);
    }
  }

  // Broadcast sync trigger to all other open tabs/windows
  broadcastSync(entity = 'all') {
    try {
      if (this.broadcastChannel) {
        this.broadcastChannel.postMessage({ type: 'DATA_CHANGED', entity, timestamp: Date.now() });
      }
    } catch {}
    try {
      localStorage.setItem('nexus_sync_event', String(Date.now()));
    } catch {}
  }

  // Handle incoming live sync events with debouncing
  handleLiveSync(source = 'remote') {
    if (this._syncTimeout) clearTimeout(this._syncTimeout);
    this._syncTimeout = setTimeout(async () => {
      await this.refreshCurrentUserData(true);
    }, 250);
  }

  // Refresh current user data (Prime or Agent)
  async refreshCurrentUserData(silent = false) {
    if (!this.currentUser) return;
    if (!silent) this.setSyncStatus('Syncing...', true);
    try {
      if (this.currentUser.role === 'prime') {
        await this.refreshAllPrimeData();
      } else {
        await this.refreshAgentData();
      }
      const now = new Date();
      const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      this.setSyncStatus(`⚡ Synced ${timeStr}`, false);
    } catch (err) {
      console.warn('Sync refresh error:', err.message);
      if (!silent) this.setSyncStatus('Sync Error', false);
    }
  }

  // Synchronize all data on demand (called by sync button or after edit/entry)
  async syncAllData() {
    this.broadcastSync();
    await this.refreshCurrentUserData(false);
  }

  async syncNow() {
    this.showToast('Synchronizing all records across Prime User & Agents...', 'info');
    await this.refreshCurrentUserData(false);
    this.showToast('⚡ All records, company dues, and agent targets synchronized!');
  }

  setSyncStatus(text, spinning = false) {
    const textEl = document.getElementById('sync-status-text');
    const iconEl = document.getElementById('sync-icon');
    if (textEl) textEl.textContent = text;
    if (iconEl) {
      if (spinning) iconEl.classList.add('spinning');
      else iconEl.classList.remove('spinning');
    }
  }

  async checkDatabaseStatus() {
    if (this.supabase) {
      this.updateDbStatusUI(true, 'Supabase Cloud');
      return;
    }
    try {
      const res = await fetch('/api/system/status');
      if (res.ok) {
        const data = await res.json();
        if (data.supabaseConnected) {
          this.updateDbStatusUI(true, 'Supabase Cloud');
        } else {
          this.updateDbStatusUI(false, 'Local SQLite');
        }
      }
    } catch {
      // Offline / Static hosting without backend
      this.updateDbStatusUI(false, 'Supabase Required');
    }
  }

  // ====================================================================
  // AUTHENTICATION & SESSIONS
  // ====================================================================
  async loadAgentsForAuth() {
    const DEFAULT_AGENTS = [
      { id: 1, name: 'Alex Mercer', email: 'alex.mercer@collections.com', phone: '+1 (555) 234-5671', password: 'agent123', badgeColor: '#3b82f6', status: 'Active' },
      { id: 2, name: 'Brenda Vance', email: 'brenda.vance@collections.com', phone: '+1 (555) 345-6782', password: 'agent123', badgeColor: '#10b981', status: 'Active' },
      { id: 3, name: 'Carlos Mendez', email: 'carlos.m@collections.com', phone: '+1 (555) 456-7893', password: 'agent123', badgeColor: '#f59e0b', status: 'Active' },
      { id: 4, name: 'Diana Prince', email: 'diana.p@collections.com', phone: '+1 (555) 567-8904', password: 'agent123', badgeColor: '#ec4899', status: 'Active' },
      { id: 5, name: 'Evan Wright', email: 'evan.w@collections.com', phone: '+1 (555) 678-9015', password: 'agent123', badgeColor: '#8b5cf6', status: 'Active' }
    ];

    try {
      if (this.supabase) {
        const { data, error } = await this.supabase
          .from('agents')
          .select('*')
          .order('name');
        if (!error && data && data.length > 0) {
          this.agents = data.map(a => ({
            id: a.id,
            name: a.name,
            email: a.email,
            phone: a.phone,
            password: a.password || 'agent123',
            badgeColor: a.badge_color || '#3b82f6',
            status: a.status || 'Active'
          }));
        }
      } else {
        try {
          const res = await fetch('/api/auth/agents-list');
          if (res.ok) {
            this.agents = await res.json();
          }
        } catch {}
      }

      if (!this.agents || this.agents.length === 0) {
        this.agents = DEFAULT_AGENTS;
      }

      const select = document.getElementById('agent-select-login');
      if (select) {
        select.innerHTML = '<option value="">-- Choose Agent --</option>' +
          this.agents.map(a => `<option value="${a.id}">${a.name} (${a.email})</option>`).join('');
      }

      const chipsContainer = document.getElementById('quick-agent-login-chips');
      if (chipsContainer) {
        chipsContainer.innerHTML = this.agents.map(a => `
          <button type="button" class="quick-agent-chip" onclick="quickLoginAgent(${a.id})">
            <span style="color:${a.badgeColor}">●</span> ${a.name.split(' ')[0]}
          </button>
        `).join('');
      }
    } catch (err) {
      console.warn('Could not load agents for login:', err.message);
      this.agents = DEFAULT_AGENTS;
    }
  }

  showLoginOverlay() {
    const auth = document.getElementById('auth-overlay');
    const main = document.getElementById('main-app') || document.getElementById('app');
    if (auth) auth.style.display = 'flex';
    if (main) main.style.display = 'none';
  }

  hideLoginOverlay() {
    const auth = document.getElementById('auth-overlay');
    const main = document.getElementById('main-app') || document.getElementById('app');
    if (auth) auth.style.display = 'none';
    if (main) main.style.display = 'flex';
  }

  setLoginRole(role) {
    const primeTab = document.getElementById('tab-btn-prime-login');
    const agentTab = document.getElementById('tab-btn-agent-login');
    const primeForm = document.getElementById('form-login-prime');
    const agentForm = document.getElementById('form-login-agent');

    if (role === 'prime') {
      primeTab.classList.add('active');
      agentTab.classList.remove('active');
      primeForm.classList.add('active');
      agentForm.classList.remove('active');
    } else {
      primeTab.classList.remove('active');
      agentTab.classList.add('active');
      primeForm.classList.remove('active');
      agentForm.classList.add('active');
    }
  }

  async quickLoginPrime() {
    await this.login('prime', 'prime', 'admin123');
  }

  async quickLoginAgent(agentId) {
    await this.login('agent', agentId, 'agent123');
  }

  async login(role, identifier, password) {
    try {
      if (role === 'prime') {
        const validUsers = ['prime', 'admin', 'admin@nexus.com'];
        const isValidUser = validUsers.includes(String(identifier).trim().toLowerCase());
        if (!isValidUser || password !== 'admin123') {
          throw new Error('Invalid Prime User credentials (Use prime / admin123)');
        }
        this.currentUser = {
          id: 0,
          name: 'Master Administrator',
          role: 'prime',
          email: 'admin@nexus.com'
        };
      } else {
        // Agent Login
        const DEFAULT_AGENTS = [
          { id: 1, name: 'Alex Mercer', email: 'alex.mercer@collections.com', phone: '+1 (555) 234-5671', badgeColor: '#3b82f6', role: 'agent' },
          { id: 2, name: 'Brenda Vance', email: 'brenda.vance@collections.com', phone: '+1 (555) 345-6782', badgeColor: '#10b981', role: 'agent' },
          { id: 3, name: 'Carlos Mendez', email: 'carlos.m@collections.com', phone: '+1 (555) 456-7893', badgeColor: '#f59e0b', role: 'agent' },
          { id: 4, name: 'Diana Prince', email: 'diana.p@collections.com', phone: '+1 (555) 567-8904', badgeColor: '#ec4899', role: 'agent' },
          { id: 5, name: 'Evan Wright', email: 'evan.w@collections.com', phone: '+1 (555) 678-9015', badgeColor: '#8b5cf6', role: 'agent' }
        ];
        let agent = (this.agents && this.agents.length > 0 ? this.agents : DEFAULT_AGENTS).find(a => Number(a.id) === Number(identifier));
        if (!agent) {
          agent = DEFAULT_AGENTS[0];
        }
        const expectedPwd = agent.password || 'agent123';
        if (password !== expectedPwd && password !== 'agent123') {
          throw new Error('Incorrect agent passcode (Default: agent123)');
        }
        this.currentUser = {
          id: agent.id,
          name: agent.name,
          email: agent.email,
          phone: agent.phone || '',
          badgeColor: agent.badgeColor || '#3b82f6',
          role: 'agent'
        };
      }

      localStorage.setItem('nexus_user', JSON.stringify(this.currentUser));
      this.showToast(`Logged in as ${this.currentUser.name}!`);
      this.applyUserSession();
    } catch (err) {
      this.showToast(err.message, 'error');
    }
  }

  logout() {
    this.currentUser = null;
    localStorage.removeItem('nexus_user');
    this.showLoginOverlay();
    this.showToast('You have been logged out.');
  }

  applyUserSession() {
    if (!this.currentUser) {
      this.showLoginOverlay();
      return;
    }

    this.hideLoginOverlay();

    const roleTag = document.getElementById('nav-user-role-tag');
    const userName = document.getElementById('nav-user-name');
    const userAvatar = document.getElementById('nav-user-avatar');
    const roleSubtitle = document.getElementById('portal-role-subtitle');
    const primeButtons = document.getElementById('prime-action-buttons');
    const agentButtons = document.getElementById('agent-action-buttons');
    const primeTabs = document.getElementById('prime-nav-tabs');
    const primeView = document.getElementById('prime-view-container');
    const agentView = document.getElementById('agent-view-container');
    const contextTitle = document.getElementById('action-bar-context-title');

    if (this.currentUser.role === 'prime') {
      roleTag.textContent = 'PRIME USER / ADMIN';
      roleTag.style.color = '#fbbf24';
      userName.textContent = 'Master Administrator';
      userAvatar.innerHTML = '<span>👑</span>';
      userAvatar.style.background = 'linear-gradient(135deg, #fbbf24 0%, #d97706 100%)';
      roleSubtitle.textContent = 'Master Company & Agent Operations Hub';

      primeButtons.style.display = 'flex';
      agentButtons.style.display = 'none';
      primeTabs.style.display = 'flex';
      primeView.style.display = 'block';
      agentView.style.display = 'none';
      contextTitle.textContent = 'Prime User Controls:';

      this.refreshAllPrimeData();
    } else {
      // Agent Portal
      roleTag.textContent = 'COLLECTION AGENT';
      roleTag.style.color = '#38bdf8';
      userName.textContent = this.currentUser.name;
      const initials = this.currentUser.name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
      userAvatar.innerHTML = `<span>${initials}</span>`;
      userAvatar.style.background = this.currentUser.badgeColor || '#3b82f6';
      roleSubtitle.textContent = `Assigned Portfolio: ${this.currentUser.name}`;

      primeButtons.style.display = 'none';
      agentButtons.style.display = 'flex';
      primeTabs.style.display = 'none';
      primeView.style.display = 'none';
      agentView.style.display = 'block';
      contextTitle.textContent = `Agent Workspace (${this.currentUser.name}):`;

      this.refreshAgentData();
    }
  }

  // ====================================================================
  // CURRENCY & TABS & MODALS
  // ====================================================================
  formatMoney(amount) {
    const num = Number(amount || 0);
    return `₹${num.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
  }

  setupCurrencySelector() {
    this.currency = '₹';
    localStorage.setItem('nexus_currency', '₹');
    document.querySelectorAll('.currency-symbol').forEach(el => el.textContent = '₹');
  }

  setupTabs() {
    const tabButtons = document.querySelectorAll('.tab-btn');
    tabButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        const targetTab = btn.getAttribute('data-tab');
        this.switchTab(targetTab);
      });
    });
  }

  switchTab(tabId) {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

    const btn = document.querySelector(`.tab-btn[data-tab="${tabId}"]`);
    const content = document.getElementById(tabId);

    if (btn) btn.classList.add('active');
    if (content) content.classList.add('active');

    if (tabId === 'tab-dashboard') {
      setTimeout(() => this.drawPieChart(), 50);
    }
  }

  setupModals() {
    document.querySelectorAll('.modal-backdrop').forEach(modal => {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) {
          modal.classList.remove('open');
        }
      });
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        document.querySelectorAll('.modal-backdrop.open').forEach(m => m.classList.remove('open'));
      }
    });
  }

  openModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) modal.classList.add('open');
  }

  closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) modal.classList.remove('open');
  }

  showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    let icon = '✓';
    if (type === 'error') icon = '✕';
    if (type === 'info') icon = 'ℹ';

    toast.innerHTML = `<span style="font-weight: bold;">${icon}</span> <span>${message}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(20px)';
      toast.style.transition = 'all 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 3800);
  }

  setupQuickButtons() {
    // Prime User Action Buttons
    document.getElementById('btn-open-invoice-modal')?.addEventListener('click', () => this.openAddInvoiceModal());
    document.getElementById('btn-add-invoice-tab')?.addEventListener('click', () => this.openAddInvoiceModal());
    document.getElementById('btn-open-company-modal')?.addEventListener('click', () => this.openAddCompanyModal());
    document.getElementById('btn-add-company-tab')?.addEventListener('click', () => this.openAddCompanyModal());
    document.getElementById('btn-open-agent-modal')?.addEventListener('click', () => this.openAddAgentModal());
    document.getElementById('btn-add-agent-tab')?.addEventListener('click', () => this.openAddAgentModal());
    document.getElementById('btn-open-reward-modal')?.addEventListener('click', () => this.openGrantRewardModal());
    document.getElementById('btn-grant-reward-tab')?.addEventListener('click', () => this.openGrantRewardModal());
    document.getElementById('btn-quick-reward')?.addEventListener('click', () => this.openGrantRewardModal());
    document.getElementById('btn-open-record-modal-prime')?.addEventListener('click', () => this.openRecordCollectionModal());
    document.getElementById('btn-record-ledger-tab')?.addEventListener('click', () => this.openRecordCollectionModal());

    // Agent Action Buttons
    document.getElementById('btn-agent-record-collection')?.addEventListener('click', () => this.openRecordCollectionModal());

    // Supabase Connect Triggers
    document.getElementById('auth-db-banner')?.addEventListener('click', () => this.openSupabaseConfigModal());
    document.getElementById('auth-db-action-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.openSupabaseConfigModal();
    });
    document.getElementById('db-status-badge')?.addEventListener('click', () => this.openSupabaseConfigModal());

    // Export CSV (Dual Mode: Browser CSV download or server endpoint)
    document.getElementById('btn-export-csv')?.addEventListener('click', () => {
      this.exportCollectionsCSV();
    });
  }

  exportCollectionsCSV() {
    if (!this.collections || this.collections.length === 0) {
      this.showToast('No collections to export', 'error');
      return;
    }

    const headers = ['Collection ID', 'Reference No', 'Company', 'Agent', 'Amount', 'Payment Date', 'Payment Method', 'Recorded By', 'Notes'];
    const rows = this.collections.map(c => [
      c.id,
      `"${(c.reference_no || '').replace(/"/g, '""')}"`,
      `"${(c.company_name || '').replace(/"/g, '""')}"`,
      `"${(c.agent_name || '').replace(/"/g, '""')}"`,
      c.amount,
      c.payment_date,
      `"${(c.payment_method || '').replace(/"/g, '""')}"`,
      `"${(c.recorded_by || '').replace(/"/g, '""')}"`,
      `"${(c.notes || '').replace(/"/g, '""')}"`
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `nexus_collections_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    this.showToast('Collections Audit CSV downloaded successfully!');
  }

  // ====================================================================
  // PRIME USER DATA LOADING & RENDERING
  // ====================================================================
  async refreshAllPrimeData() {
    try {
      if (this.supabase) {
        // Direct Query from Supabase Cloud
        const [compRes, invRes, colRes, rewRes, agtRes] = await Promise.all([
          this.supabase.from('companies').select('*, agents(name, badge_color)').order('name'),
          this.supabase.from('invoices').select('*, companies(name, agent_id, agents(name, badge_color))').order('invoice_date', { ascending: false }),
          this.supabase.from('collections').select('*, companies(name, target_amount), agents(name, badge_color)').order('payment_date', { ascending: false }),
          this.supabase.from('rewards').select('*, agents(name, badge_color, email)').order('awarded_date', { ascending: false }),
          this.supabase.from('agents').select('*').order('name')
        ]);

        if (compRes.error) throw compRes.error;
        if (invRes.error) throw invRes.error;
        if (colRes.error) throw colRes.error;
        if (rewRes.error) throw rewRes.error;
        if (agtRes.error) throw agtRes.error;

        // Process Agents
        this.agents = (agtRes.data || []).map(a => ({
          id: a.id,
          name: a.name,
          email: a.email,
          phone: a.phone,
          password: a.password || 'agent123',
          badgeColor: a.badge_color || '#3b82f6',
          status: a.status || 'Active'
        }));

        // Process Invoices
        this.invoices = (invRes.data || []).map(i => ({
          id: i.id,
          company_id: i.company_id,
          company_name: i.companies?.name || 'Unknown',
          agent_id: i.companies?.agent_id,
          agent_name: i.companies?.agents?.name || 'Unassigned',
          agent_color: i.companies?.agents?.badge_color || '#64748b',
          invoice_number: i.invoice_number,
          invoice_date: i.invoice_date,
          due_date: i.due_date,
          amount: Number(i.amount || 0),
          notes: i.notes,
          created_by: i.created_by || 'Prime User'
        }));

        // Process Collections
        this.collections = (colRes.data || []).map(c => ({
          id: c.id,
          company_id: c.company_id,
          company_name: c.companies?.name || 'Unknown',
          agent_id: c.agent_id,
          agent_name: c.agents?.name || 'Unassigned',
          agent_color: c.agents?.badge_color || '#4f46e5',
          invoice_id: c.invoice_id,
          amount: Number(c.amount || 0),
          payment_date: c.payment_date,
          payment_method: c.payment_method || 'Bank Transfer',
          reference_no: c.reference_no,
          notes: c.notes,
          recorded_by: c.recorded_by || 'Prime User'
        }));

        // Process Rewards
        this.rewards = (rewRes.data || []).map(r => ({
          id: r.id,
          agent_id: r.agent_id,
          agent_name: r.agents?.name || 'Unknown',
          agent_color: r.agents?.badge_color || '#f59e0b',
          amount: Number(r.amount || 0),
          reward_type: r.reward_type || 'Performance Bonus',
          reason: r.reason,
          status: r.status || 'Awarded',
          awarded_date: r.awarded_date
        }));

        // Process Companies & Financial Totals
        this.companies = (compRes.data || []).map(c => {
          const compInvoices = this.invoices.filter(i => Number(i.company_id) === Number(c.id));
          const invSum = compInvoices.reduce((s, i) => s + Number(i.amount || 0), 0);
          const target = Number(c.target_amount) > 0 ? Number(c.target_amount) : invSum;

          const compCollections = this.collections.filter(col => Number(col.company_id) === Number(c.id));
          const collected = compCollections.reduce((s, col) => s + Number(col.amount || 0), 0);
          const pending = Math.max(0, target - collected);
          const progress = target > 0 ? Number(((collected / target) * 100).toFixed(1)) : 0;
          const status = (collected >= target && target > 0) ? 'Completed' : (collected > 0 ? 'In Progress' : 'Pending');

          return {
            id: c.id,
            name: c.name,
            contact_person: c.contact_person,
            contact_phone: c.contact_phone,
            category: c.category || 'General',
            target_amount: target,
            collected_amount: collected,
            pending_amount: pending,
            progress_percent: progress,
            agent_id: c.agent_id,
            agent_name: c.agents?.name || 'Unassigned',
            agent_color: c.agents?.badge_color || '#64748b',
            status,
            notes: c.notes
          };
        });

        // Compute Agent Share & Performance Breakdown
        const totalAllCollected = this.collections.reduce((s, c) => s + c.amount, 0);
        this.agentShare = this.agents.map(agent => {
          const agentCollections = this.collections.filter(c => Number(c.agent_id) === Number(agent.id));
          const totalCollected = agentCollections.reduce((s, c) => s + c.amount, 0);

          const agentCompanies = this.companies.filter(c => Number(c.agent_id) === Number(agent.id));
          const assignedTarget = agentCompanies.reduce((s, c) => s + c.target_amount, 0);
          const companyCount = agentCompanies.length;

          const agentRewards = this.rewards.filter(r => Number(r.agent_id) === Number(agent.id));
          const totalRewards = agentRewards.reduce((s, r) => s + r.amount, 0);

          const percentageOfTotal = totalAllCollected > 0 ? Number(((totalCollected / totalAllCollected) * 100).toFixed(1)) : 0;
          const targetAchievementRate = assignedTarget > 0 ? Number(((totalCollected / assignedTarget) * 100).toFixed(1)) : 0;

          let suggestedTier = 'Standard';
          let bonusPercent = 0;
          if (targetAchievementRate >= 95) {
            suggestedTier = 'Platinum Elite';
            bonusPercent = 5.0;
          } else if (targetAchievementRate >= 85) {
            suggestedTier = 'Gold Tier';
            bonusPercent = 3.5;
          } else if (targetAchievementRate >= 70) {
            suggestedTier = 'Silver Tier';
            bonusPercent = 2.0;
          } else if (targetAchievementRate >= 50) {
            suggestedTier = 'Bronze Tier';
            bonusPercent = 1.0;
          }

          const suggestedBonus = Math.round((totalCollected * bonusPercent) / 100);

          return {
            id: agent.id,
            name: agent.name,
            email: agent.email,
            phone: agent.phone,
            badgeColor: agent.badgeColor,
            totalCollected,
            assignedTarget,
            companyCount,
            totalRewards,
            percentageOfTotal,
            targetAchievementRate,
            suggestedTier,
            suggestedBonus
          };
        });

        this.agentShare.sort((a, b) => b.totalCollected - a.totalCollected);
        this.agentShare.forEach((a, idx) => a.rank = idx + 1);

        // Overall Stats
        const totalTarget = this.companies.reduce((s, c) => s + c.target_amount, 0);
        const totalCollected = totalAllCollected;
        const pendingAmount = Math.max(0, totalTarget - totalCollected);
        const progressPercent = totalTarget > 0 ? Number(((totalCollected / totalTarget) * 100).toFixed(1)) : 0;
        const totalRewardsDistributed = this.rewards.reduce((s, r) => s + r.amount, 0);
        const topAgent = this.agentShare.find(a => a.totalCollected > 0) || this.agentShare[0] || null;

        this.stats = {
          totalTarget,
          totalCollected,
          pendingAmount,
          progressPercent,
          totalCompanies: this.companies.length,
          totalInvoices: this.invoices.length,
          activeAgentsCount: this.agents.length,
          totalRewardsDistributed,
          rewardCount: this.rewards.length,
          topAgent
        };

        this.renderPrimeData();
      } else {
        // Fallback to local Node.js Server or local seed data
        try {
          const [statsRes, shareRes, compRes, colRes, rewRes, invRes] = await Promise.all([
            fetch('/api/dashboard/stats'),
            fetch('/api/dashboard/agent-share'),
            fetch('/api/companies'),
            fetch('/api/collections?limit=100'),
            fetch('/api/rewards'),
            fetch('/api/invoices')
          ]);

          this.stats = await statsRes.json();
          this.agentShare = await shareRes.json();
          this.companies = await compRes.json();
          this.collections = await colRes.json();
          this.rewards = await rewRes.json();
          this.invoices = await invRes.json();
        } catch {
          // GitHub Pages / Static fallback before Supabase is connected
          this.companies = [
            { id: 1, name: 'Apex Logistics Inc.', category: 'Logistics', contact_person: 'Marcus Brody', contact_phone: '+1 (555) 111-2201', agent_id: 1, agent_name: 'Alex Mercer', agent_color: '#3b82f6', target_amount: 35000, collected_amount: 20000, pending_amount: 15000, progress_percent: 57.1, status: 'In Progress' },
            { id: 2, name: 'Nexus Tech Solutions', category: 'Technology', contact_person: 'Sophia Chen', contact_phone: '+1 (555) 111-2202', agent_id: 1, agent_name: 'Alex Mercer', agent_color: '#3b82f6', target_amount: 50000, collected_amount: 35000, pending_amount: 15000, progress_percent: 70.0, status: 'In Progress' },
            { id: 3, name: 'Global Retail Brands', category: 'Retail', contact_person: 'David Kim', contact_phone: '+1 (555) 222-3301', agent_id: 2, agent_name: 'Brenda Vance', agent_color: '#10b981', target_amount: 60000, collected_amount: 45000, pending_amount: 15000, progress_percent: 75.0, status: 'In Progress' },
            { id: 4, name: 'Horizon Media Network', category: 'Media & Ads', contact_person: 'Rachel Green', contact_phone: '+1 (555) 222-3302', agent_id: 2, agent_name: 'Brenda Vance', agent_color: '#10b981', target_amount: 40000, collected_amount: 30000, pending_amount: 10000, progress_percent: 75.0, status: 'In Progress' },
            { id: 5, name: 'Quantum Manufacturing', category: 'Manufacturing', contact_person: 'Heinrich Becker', contact_phone: '+1 (555) 333-4401', agent_id: 3, agent_name: 'Carlos Mendez', agent_color: '#f59e0b', target_amount: 75000, collected_amount: 50000, pending_amount: 25000, progress_percent: 66.7, status: 'In Progress' },
            { id: 6, name: 'Vertex Financial Group', category: 'Finance', contact_person: 'Elena Rostov', contact_phone: '+1 (555) 333-4402', agent_id: 3, agent_name: 'Carlos Mendez', agent_color: '#f59e0b', target_amount: 25000, collected_amount: 15000, pending_amount: 10000, progress_percent: 60.0, status: 'In Progress' },
            { id: 7, name: 'Stellar Pharma Labs', category: 'Healthcare', contact_person: 'Dr. Arthur Pendelton', contact_phone: '+1 (555) 444-5501', agent_id: 4, agent_name: 'Diana Prince', agent_color: '#ec4899', target_amount: 80000, collected_amount: 65000, pending_amount: 15000, progress_percent: 81.3, status: 'In Progress' },
            { id: 8, name: 'BlueWave Maritime', category: 'Shipping', contact_person: 'Captain Nathan Ortiz', contact_phone: '+1 (555) 444-5502', agent_id: 4, agent_name: 'Diana Prince', agent_color: '#ec4899', target_amount: 30000, collected_amount: 18000, pending_amount: 12000, progress_percent: 60.0, status: 'In Progress' },
            { id: 9, name: 'Titan Construction Works', category: 'Infrastructure', contact_person: 'Frank Castle', contact_phone: '+1 (555) 555-6601', agent_id: 5, agent_name: 'Evan Wright', agent_color: '#8b5cf6', target_amount: 55000, collected_amount: 32000, pending_amount: 23000, progress_percent: 58.2, status: 'In Progress' },
            { id: 10, name: 'Aurora Clean Energy', category: 'Renewables', contact_person: 'Dr. Lisa Wong', contact_phone: '+1 (555) 555-6602', agent_id: 5, agent_name: 'Evan Wright', agent_color: '#8b5cf6', target_amount: 45000, collected_amount: 25000, pending_amount: 20000, progress_percent: 55.6, status: 'In Progress' }
          ];

          this.invoices = [
            { id: 1, invoice_number: 'INV-2026-101', invoice_date: '2026-10-01', due_date: '2026-10-31', company_id: 1, company_name: 'Apex Logistics Inc.', agent_id: 1, agent_name: 'Alex Mercer', agent_color: '#3b82f6', amount: 20000, notes: 'Freight dispatch batch #A1', created_by: 'Prime User' },
            { id: 2, invoice_number: 'INV-2026-102', invoice_date: '2026-10-08', due_date: '2026-11-08', company_id: 1, company_name: 'Apex Logistics Inc.', agent_id: 1, agent_name: 'Alex Mercer', agent_color: '#3b82f6', amount: 15000, notes: 'Interstate logistics dues #B4', created_by: 'Prime User' },
            { id: 3, invoice_number: 'INV-2026-103', invoice_date: '2026-10-02', due_date: '2026-11-02', company_id: 2, company_name: 'Nexus Tech Solutions', agent_id: 1, agent_name: 'Alex Mercer', agent_color: '#3b82f6', amount: 30000, notes: 'Enterprise annual cloud licenses', created_by: 'Prime User' },
            { id: 4, invoice_number: 'INV-2026-104', invoice_date: '2026-10-10', due_date: '2026-11-10', company_id: 2, company_name: 'Nexus Tech Solutions', agent_id: 1, agent_name: 'Alex Mercer', agent_color: '#3b82f6', amount: 20000, notes: 'Platform security suite add-on', created_by: 'Prime User' },
            { id: 5, invoice_number: 'INV-2026-105', invoice_date: '2026-10-03', due_date: '2026-11-03', company_id: 3, company_name: 'Global Retail Brands', agent_id: 2, agent_name: 'Brenda Vance', agent_color: '#10b981', amount: 35000, notes: 'Q3 retail inventory consignment', created_by: 'Prime User' },
            { id: 6, invoice_number: 'INV-2026-106', invoice_date: '2026-10-12', due_date: '2026-11-12', company_id: 3, company_name: 'Global Retail Brands', agent_id: 2, agent_name: 'Brenda Vance', agent_color: '#10b981', amount: 25000, notes: 'Store fixture lines credit', created_by: 'Prime User' }
          ];

          this.collections = [
            { id: 1, reference_no: 'TXN-90214', company_name: 'Apex Logistics Inc.', company_id: 1, agent_id: 1, agent_name: 'Alex Mercer', agent_color: '#3b82f6', amount: 20000, payment_date: '2026-10-12', payment_method: 'Bank Transfer', recorded_by: 'Agent: Alex Mercer' },
            { id: 2, reference_no: 'TXN-90288', company_name: 'Nexus Tech Solutions', company_id: 2, agent_id: 1, agent_name: 'Alex Mercer', agent_color: '#3b82f6', amount: 35000, payment_date: '2026-10-18', payment_method: 'Wire Transfer', recorded_by: 'Agent: Alex Mercer' },
            { id: 3, reference_no: 'TXN-90230', company_name: 'Global Retail Brands', company_id: 3, agent_id: 2, agent_name: 'Brenda Vance', agent_color: '#10b981', amount: 45000, payment_date: '2026-10-14', payment_method: 'Bank Transfer', recorded_by: 'Agent: Brenda Vance' }
          ];

          this.rewards = [
            { id: 1, agent_id: 4, agent_name: 'Diana Prince', agent_color: '#ec4899', amount: 1500, reward_type: 'Top Collector Award', reason: 'Outstanding collection performance exceeding threshold', status: 'Paid', awarded_date: '2026-10-23' },
            { id: 2, agent_id: 2, agent_name: 'Brenda Vance', agent_color: '#10b981', amount: 1000, reward_type: 'Milestone Bonus', reason: 'Achieved 75% collection milestone across assigned portfolio', status: 'Paid', awarded_date: '2026-10-22' }
          ];

          this.agentShare = [
            { id: 4, name: 'Diana Prince', badgeColor: '#ec4899', totalCollected: 83000, assignedTarget: 110000, companyCount: 2, totalRewards: 1500, percentageOfTotal: 25.5, targetAchievementRate: 75.5, suggestedTier: 'Silver Tier', suggestedBonus: 1660, rank: 1 },
            { id: 2, name: 'Brenda Vance', badgeColor: '#10b981', totalCollected: 75000, assignedTarget: 100000, companyCount: 2, totalRewards: 1000, percentageOfTotal: 23.1, targetAchievementRate: 75.0, suggestedTier: 'Silver Tier', suggestedBonus: 1500, rank: 2 },
            { id: 3, name: 'Carlos Mendez', badgeColor: '#f59e0b', totalCollected: 65000, assignedTarget: 100000, companyCount: 2, totalRewards: 750, percentageOfTotal: 20.0, targetAchievementRate: 65.0, suggestedTier: 'Bronze Tier', suggestedBonus: 650, rank: 3 },
            { id: 5, name: 'Evan Wright', badgeColor: '#8b5cf6', totalCollected: 57000, assignedTarget: 100000, companyCount: 2, totalRewards: 500, percentageOfTotal: 17.5, targetAchievementRate: 57.0, suggestedTier: 'Bronze Tier', suggestedBonus: 570, rank: 4 },
            { id: 1, name: 'Alex Mercer', badgeColor: '#3b82f6', totalCollected: 55000, assignedTarget: 85000, companyCount: 2, totalRewards: 500, percentageOfTotal: 16.9, targetAchievementRate: 64.7, suggestedTier: 'Bronze Tier', suggestedBonus: 550, rank: 5 }
          ];

          this.stats = {
            totalTarget: 495000,
            totalCollected: 335000,
            pendingAmount: 160000,
            progressPercent: 67.7,
            totalCompanies: 10,
            totalInvoices: 16,
            activeAgentsCount: 5,
            totalRewardsDistributed: 4250,
            rewardCount: 5,
            topAgent: this.agentShare[0]
          };
        }

        this.renderPrimeData();
      }
    } catch (err) {
      console.error('Error refreshing prime data:', err);
      this.showToast('Failed to load database records', 'error');
    }
  }

  renderPrimeData() {
    this.renderPrimeStats();
    this.renderProgressBar();
    this.drawPieChart();
    this.renderPieLegend();
    this.renderLeaderboard();
    this.renderRecentCollections();
    this.renderInvoicesTable();
    this.renderCompaniesTable();
    this.renderAgentsFleet();
    this.renderRewardsTable();
    this.renderLedgerTable();
    this.populateSelectDropdowns();
  }

  renderPrimeStats() {
    if (!this.stats) return;

    document.getElementById('stat-total-target').textContent = this.formatMoney(this.stats.totalTarget);
    document.getElementById('stat-total-collected').textContent = this.formatMoney(this.stats.totalCollected);
    document.getElementById('stat-pending-amount').textContent = this.formatMoney(this.stats.pendingAmount);
    document.getElementById('stat-collected-pct').textContent = `${this.stats.progressPercent}% Collected`;
    document.getElementById('stat-company-count-badge').textContent = this.stats.totalCompanies;
    document.getElementById('stat-invoice-count-badge').textContent = this.stats.totalInvoices || 0;
    document.getElementById('stat-active-agents').textContent = this.stats.activeAgentsCount;
    document.getElementById('stat-total-rewards').textContent = this.formatMoney(this.stats.totalRewardsDistributed);
    document.getElementById('stat-reward-count').textContent = this.stats.rewardCount;

    document.getElementById('tab-invoice-count').textContent = this.invoices.length;
    document.getElementById('tab-company-count').textContent = this.stats.totalCompanies;
    document.getElementById('tab-agent-count').textContent = this.stats.activeAgentsCount;

    if (this.stats.topAgent) {
      document.getElementById('stat-top-agent-name').textContent = this.stats.topAgent.name;
    }
  }

  renderProgressBar() {
    if (!this.stats) return;
    const bar = document.getElementById('overall-progress-bar');
    const text = document.getElementById('overall-progress-text');
    const amounts = document.getElementById('overall-amounts-text');

    const pct = Math.min(100, this.stats.progressPercent);
    if (bar) bar.style.width = `${pct}%`;
    if (text) text.textContent = `${pct}% Recovered`;
    if (amounts) amounts.textContent = `${this.formatMoney(this.stats.totalCollected)} / ${this.formatMoney(this.stats.totalTarget)}`;
  }

  // ====================================================================
  // PIE CHART (HTML5 CANVAS)
  // ====================================================================
  drawPieChart() {
    const canvas = document.getElementById('agentPieChart');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;
    const centerX = width / 2;
    const centerY = height / 2;
    const outerRadius = Math.min(centerX, centerY) - 15;
    const innerRadius = outerRadius * 0.58;

    ctx.clearRect(0, 0, width, height);

    if (!this.agentShare || this.agentShare.length === 0) {
      ctx.fillStyle = '#64748b';
      ctx.font = '14px Inter, sans-serif';
      ctx.textAlign = 'center';
      if (typeof ctx.fillText === 'function') {
        ctx.fillText('No collection data recorded', centerX, centerY);
      }
      return;
    }

    const totalCollected = this.agentShare.reduce((sum, a) => sum + a.totalCollected, 0);

    const overlayVal = document.getElementById('overlay-collected-val');
    const overlayAgents = document.getElementById('overlay-agent-count');
    if (overlayVal) overlayVal.textContent = this.formatMoney(totalCollected);
    if (overlayAgents) overlayAgents.textContent = `${this.agentShare.length} Active Agents`;

    if (totalCollected === 0) {
      ctx.beginPath();
      ctx.arc(centerX, centerY, outerRadius, 0, 2 * Math.PI);
      ctx.arc(centerX, centerY, innerRadius, 2 * Math.PI, 0, true);
      ctx.fillStyle = '#1e293b';
      ctx.fill();
      return;
    }

    let startAngle = -Math.PI / 2;
    this.pieSlices = [];

    this.agentShare.forEach((agent, index) => {
      const sliceAngle = (agent.totalCollected / totalCollected) * (2 * Math.PI);
      const endAngle = startAngle + sliceAngle;
      const isHovered = this.hoveredSliceIndex === index;

      let drawRadius = outerRadius;
      let offsetX = 0;
      let offsetY = 0;

      if (isHovered) {
        drawRadius += 8;
        const midAngle = startAngle + sliceAngle / 2;
        offsetX = Math.cos(midAngle) * 6;
        offsetY = Math.sin(midAngle) * 6;
      }

      ctx.save();
      ctx.translate(offsetX, offsetY);

      ctx.beginPath();
      ctx.arc(centerX, centerY, drawRadius, startAngle, endAngle);
      ctx.arc(centerX, centerY, innerRadius, endAngle, startAngle, true);
      ctx.closePath();

      ctx.fillStyle = agent.badgeColor || '#4f46e5';
      ctx.fill();

      ctx.lineWidth = 3;
      ctx.strokeStyle = '#111827';
      ctx.stroke();

      ctx.restore();

      this.pieSlices.push({
        agent,
        index,
        startAngle,
        endAngle,
        innerRadius,
        outerRadius: drawRadius,
        color: agent.badgeColor
      });

      startAngle = endAngle;
    });
  }

  setupCanvasInteractivity() {
    const canvas = document.getElementById('agentPieChart');
    if (!canvas) return;

    canvas.addEventListener('mousemove', (e) => {
      const rect = canvas.getBoundingClientRect();
      const x = (e.clientX - rect.left) * (canvas.width / rect.width);
      const y = (e.clientY - rect.top) * (canvas.height / rect.height);

      const centerX = canvas.width / 2;
      const centerY = canvas.height / 2;

      const dx = x - centerX;
      const dy = y - centerY;
      const dist = Math.sqrt(dx * dx + dy * dy);

      let angle = Math.atan2(dy, dx);
      if (angle < -Math.PI / 2) {
        angle += 2 * Math.PI;
      }

      let hovered = -1;
      if (this.pieSlices) {
        for (let i = 0; i < this.pieSlices.length; i++) {
          const slice = this.pieSlices[i];
          if (dist >= slice.innerRadius && dist <= slice.outerRadius + 8) {
            let start = slice.startAngle;
            let end = slice.endAngle;
            if (angle >= start && angle <= end) {
              hovered = i;
              break;
            }
          }
        }
      }

      if (hovered !== this.hoveredSliceIndex) {
        this.hoveredSliceIndex = hovered;
        this.drawPieChart();
        this.updateLegendHighlight(hovered);

        if (hovered !== -1) {
          const ag = this.agentShare[hovered];
          document.getElementById('overlay-collected-val').textContent = this.formatMoney(ag.totalCollected);
          document.getElementById('overlay-agent-count').textContent = `${ag.name} (${ag.percentageOfTotal}%)`;
        } else {
          const totalCollected = this.agentShare.reduce((sum, a) => sum + a.totalCollected, 0);
          document.getElementById('overlay-collected-val').textContent = this.formatMoney(totalCollected);
          document.getElementById('overlay-agent-count').textContent = `${this.agentShare.length} Active Agents`;
        }
      }
    });

    canvas.addEventListener('mouseleave', () => {
      if (this.hoveredSliceIndex !== -1) {
        this.hoveredSliceIndex = -1;
        this.drawPieChart();
        this.updateLegendHighlight(-1);
        const totalCollected = this.agentShare.reduce((sum, a) => sum + a.totalCollected, 0);
        document.getElementById('overlay-collected-val').textContent = this.formatMoney(totalCollected);
        document.getElementById('overlay-agent-count').textContent = `${this.agentShare.length} Active Agents`;
      }
    });
  }

  updateLegendHighlight(index) {
    document.querySelectorAll('.legend-item').forEach((item, i) => {
      if (i === index) item.classList.add('highlighted');
      else item.classList.remove('highlighted');
    });
  }

  renderPieLegend() {
    const container = document.getElementById('pie-legend-list');
    if (!container) return;

    container.innerHTML = this.agentShare.map((agent, index) => `
      <div class="legend-item" data-index="${index}" onclick="app.highlightAgentFromLegend(${index})">
        <div class="legend-left">
          <div class="legend-color-dot" style="background-color: ${agent.badgeColor};"></div>
          <div>
            <div class="legend-name">${agent.name}</div>
            <div class="legend-companies">${agent.companyCount} companies &bull; Target: ${this.formatMoney(agent.assignedTarget)}</div>
          </div>
        </div>
        <div class="legend-right">
          <div class="legend-amount">${this.formatMoney(agent.totalCollected)}</div>
          <span class="legend-pct-badge">${agent.percentageOfTotal}% share</span>
        </div>
      </div>
    `).join('');
  }

  highlightAgentFromLegend(index) {
    this.hoveredSliceIndex = this.hoveredSliceIndex === index ? -1 : index;
    this.drawPieChart();
    this.updateLegendHighlight(this.hoveredSliceIndex);
  }

  renderLeaderboard() {
    const container = document.getElementById('leaderboard-container');
    if (!container) return;

    container.innerHTML = this.agentShare.map((agent) => {
      let rankClass = 'rank-other';
      if (agent.rank === 1) rankClass = 'rank-1';
      else if (agent.rank === 2) rankClass = 'rank-2';
      else if (agent.rank === 3) rankClass = 'rank-3';

      const achRate = Math.min(100, agent.targetAchievementRate);

      return `
        <div class="leaderboard-card">
          <div class="rank-badge ${rankClass}">#${agent.rank}</div>
          <div class="card-agent-info">
            <div class="agent-name-row">
              <span class="agent-card-name">${agent.name}</span>
              <span class="agent-tier-badge">${agent.suggestedTier}</span>
            </div>
            <div class="agent-mini-bar">
              <div class="agent-mini-fill" style="width: ${achRate}%; background-color: ${agent.badgeColor};"></div>
            </div>
            <div class="agent-progress-meta">
              <span>${achRate}% of target (${this.formatMoney(agent.assignedTarget)})</span>
              <span>${agent.percentageOfTotal}% total share</span>
            </div>
          </div>
          <div class="card-metrics">
            <div class="card-collected-val">${this.formatMoney(agent.totalCollected)}</div>
            <div class="card-reward-earned">Rewards: ${this.formatMoney(agent.totalRewards)}</div>
            <button class="btn btn-card-reward btn-amber" onclick="app.quickRewardAgent(${agent.id}, '${agent.name}', ${agent.suggestedBonus})">
              + Reward
            </button>
          </div>
        </div>
      `;
    }).join('');
  }

  renderRecentCollections() {
    const tbody = document.getElementById('recent-collections-tbody');
    if (!tbody) return;

    const recent = this.collections.slice(0, 6);
    if (recent.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding:1.5rem; color:#64748b;">No collections recorded</td></tr>';
      return;
    }

    tbody.innerHTML = recent.map(c => `
      <tr>
        <td><strong style="color:#818cf8; font-family:'JetBrains Mono',monospace;">${c.reference_no || 'TXN-' + c.id}</strong></td>
        <td><strong>${c.company_name}</strong></td>
        <td>
          <span style="display:inline-flex; align-items:center; gap:0.4rem;">
            <span style="width:8px; height:8px; border-radius:50%; background:${c.agent_color || '#4f46e5'};"></span>
            ${c.agent_name || 'Unassigned'}
          </span>
        </td>
        <td style="color:#34d399; font-weight:700; font-family:'JetBrains Mono',monospace;">${this.formatMoney(c.amount)}</td>
        <td>${c.payment_date}</td>
        <td><span class="metric-badge badge-info">${c.payment_method}</span></td>
        <td><span class="metric-badge badge-purple">${c.recorded_by || 'Prime User'}</span></td>
      </tr>
    `).join('');
  }

  // ====================================================================
  // PRIME INVOICES TABLE
  // ====================================================================
  renderInvoicesTable() {
    const tbody = document.getElementById('invoices-table-tbody');
    if (!tbody) return;

    const summaryCard = document.getElementById('invoice-filter-summary-card');
    const tfoot = document.getElementById('invoices-table-tfoot');
    const bottomSummaryBar = document.getElementById('invoice-bottom-summary-bar');

    const search = (document.getElementById('invoice-search')?.value || '').toLowerCase();
    const filterCompany = document.getElementById('filter-invoice-company')?.value || '';
    const filterAgent = document.getElementById('filter-invoice-agent')?.value || '';
    const filterMonth = document.getElementById('filter-invoice-month')?.value || '';
    const filterDateFrom = document.getElementById('filter-invoice-date-from')?.value || '';
    const filterDateTo = document.getElementById('filter-invoice-date-to')?.value || '';

    let monthLabel = '';
    if (filterMonth) {
      const [yr, mo] = filterMonth.split('-');
      const d = new Date(Number(yr), Number(mo) - 1, 1);
      monthLabel = isNaN(d) ? filterMonth : d.toLocaleString('en-US', { month: 'long', year: 'numeric' });
    }

    let dateLabel = '';
    if (filterDateFrom && filterDateTo) {
      dateLabel = `${filterDateFrom} to ${filterDateTo}`;
    } else if (filterDateFrom) {
      dateLabel = `Date: ${filterDateFrom}`;
    } else if (filterDateTo) {
      dateLabel = `Up to: ${filterDateTo}`;
    }

    const filtered = this.invoices.filter(inv => {
      const matchSearch = !search ||
                          inv.invoice_number.toLowerCase().includes(search) ||
                          inv.company_name.toLowerCase().includes(search) ||
                          (inv.agent_name && inv.agent_name.toLowerCase().includes(search));
      const matchCompany = !filterCompany || String(inv.company_id) === filterCompany;
      const matchAgent = !filterAgent || String(inv.agent_id) === filterAgent;
      const matchMonth = !filterMonth || (inv.invoice_date && inv.invoice_date.startsWith(filterMonth));

      let matchDate = true;
      if (filterDateFrom && filterDateTo) {
        matchDate = inv.invoice_date >= filterDateFrom && inv.invoice_date <= filterDateTo;
      } else if (filterDateFrom && !filterDateTo) {
        matchDate = inv.invoice_date === filterDateFrom;
      } else if (!filterDateFrom && filterDateTo) {
        matchDate = inv.invoice_date <= filterDateTo;
      }

      return matchSearch && matchCompany && matchAgent && matchMonth && matchDate;
    });

    // Compute dynamic totals
    const totalCount = filtered.length;
    const totalAmount = filtered.reduce((sum, inv) => sum + (Number(inv.amount) || 0), 0);

    // Look up selected Company and Agent metadata
    const selectedCompany = filterCompany ? this.companies.find(c => String(c.id) === String(filterCompany)) : null;
    const selectedAgent = filterAgent ? (this.agentShare.find(a => String(a.id) === String(filterAgent)) || this.agents.find(a => String(a.id) === String(filterAgent))) : null;

    const filterBadgesHtml = `
      ${monthLabel ? `<span class="metric-badge badge-blue">🗓️ ${monthLabel}</span>` : ''}
      ${dateLabel ? `<span class="metric-badge badge-purple">📅 ${dateLabel}</span>` : ''}
    `;

    // Render Dynamic Summary Card (Total Invoices & Total Bill Amount)
    if (summaryCard) {
      if (selectedCompany && selectedAgent) {
        summaryCard.innerHTML = `
          <div class="invoice-summary-left">
            <div class="invoice-summary-title">
              <span class="icon">🏢</span>
              <span>${selectedCompany.name}</span>
              <span class="metric-badge badge-blue">Category: ${selectedCompany.category || 'General'}</span>
              ${filterBadgesHtml}
            </div>
            <div class="invoice-summary-subtitle">
              <span>👤 Assigned Agent: <strong style="color:#38bdf8">${selectedAgent.name}</strong></span>
              <span>•</span>
              <span>📞 Contact: <strong>${selectedCompany.contact_person || 'N/A'} (${selectedCompany.contact_phone || 'N/A'})</strong></span>
            </div>
          </div>
          <div class="invoice-summary-metrics">
            <div class="invoice-metric-box blue">
              <span class="label">Total Invoices</span>
              <span class="val">${totalCount} Bills</span>
            </div>
            <div class="invoice-metric-box red">
              <span class="label">Total Bill Amount</span>
              <span class="val">${this.formatMoney(totalAmount)}</span>
            </div>
            <div class="invoice-metric-box emerald">
              <span class="label">Company Recovered</span>
              <span class="val">${this.formatMoney(selectedCompany.collected_amount)}</span>
            </div>
            <div class="invoice-metric-box amber">
              <span class="label">Pending Dues</span>
              <span class="val">${this.formatMoney(selectedCompany.pending_amount)}</span>
            </div>
          </div>
        `;
      } else if (selectedCompany) {
        summaryCard.innerHTML = `
          <div class="invoice-summary-left">
            <div class="invoice-summary-title">
              <span class="icon">🏢</span>
              <span>${selectedCompany.name}</span>
              <span class="metric-badge badge-blue">Category: ${selectedCompany.category || 'General'}</span>
              ${filterBadgesHtml}
            </div>
            <div class="invoice-summary-subtitle">
              <span>👤 Assigned Collector: <strong style="color:#38bdf8">${selectedCompany.agent_name || 'Unassigned'}</strong></span>
              <span>•</span>
              <span>📞 Contact: <strong>${selectedCompany.contact_person || 'N/A'} (${selectedCompany.contact_phone || 'N/A'})</strong></span>
            </div>
          </div>
          <div class="invoice-summary-metrics">
            <div class="invoice-metric-box blue">
              <span class="label">Total Invoices</span>
              <span class="val">${totalCount} Bills</span>
            </div>
            <div class="invoice-metric-box red">
              <span class="label">Total Bill Amount</span>
              <span class="val">${this.formatMoney(totalAmount)}</span>
            </div>
            <div class="invoice-metric-box emerald">
              <span class="label">Recovered Money</span>
              <span class="val">${this.formatMoney(selectedCompany.collected_amount)} (${selectedCompany.progress_percent || 0}%)</span>
            </div>
            <div class="invoice-metric-box amber">
              <span class="label">Remaining Pending</span>
              <span class="val">${this.formatMoney(selectedCompany.pending_amount)}</span>
            </div>
          </div>
        `;
      } else if (selectedAgent) {
        const assignedCompaniesCount = this.companies.filter(c => String(c.agent_id) === String(selectedAgent.id)).length;
        summaryCard.innerHTML = `
          <div class="invoice-summary-left">
            <div class="invoice-summary-title">
              <span class="icon">👤</span>
              <span>Agent Invoicing: ${selectedAgent.name}</span>
              <span class="metric-badge badge-green">Assigned Agent</span>
              ${filterBadgesHtml}
            </div>
            <div class="invoice-summary-subtitle">
              <span>🏢 Managing: <strong style="color:#38bdf8">${assignedCompaniesCount} Assigned Companies</strong></span>
              <span>•</span>
              <span>✉️ Email: <strong>${selectedAgent.email}</strong></span>
              <span>•</span>
              <span>📞 Phone: <strong>${selectedAgent.phone || 'N/A'}</strong></span>
            </div>
          </div>
          <div class="invoice-summary-metrics">
            <div class="invoice-metric-box blue">
              <span class="label">Total Invoices</span>
              <span class="val">${totalCount} Bills</span>
            </div>
            <div class="invoice-metric-box red">
              <span class="label">Total Bill Amount</span>
              <span class="val">${this.formatMoney(totalAmount)}</span>
            </div>
            <div class="invoice-metric-box emerald">
              <span class="label">Agent Recovered</span>
              <span class="val">${this.formatMoney(selectedAgent.totalCollected || 0)}</span>
            </div>
            <div class="invoice-metric-box amber">
              <span class="label">Performance Tier</span>
              <span class="val" style="font-size:0.85rem">${selectedAgent.suggestedTier || 'Standard'}</span>
            </div>
          </div>
        `;
      } else {
        const totalAllTarget = this.stats?.totalTarget || totalAmount;
        const totalAllCollected = this.stats?.totalCollected || 0;
        const totalAllPending = this.stats?.pendingAmount || Math.max(0, totalAllTarget - totalAllCollected);

        summaryCard.innerHTML = `
          <div class="invoice-summary-left">
            <div class="invoice-summary-title">
              <span class="icon">📊</span>
              <span>All Company Bills & Invoices Registry</span>
              <span class="metric-badge badge-purple">Prime Overview</span>
              ${filterBadgesHtml}
            </div>
            <div class="invoice-summary-subtitle">
              <span>Tracking <strong>${this.companies.length} Companies</strong> across <strong>${this.agents.length} Collection Agents</strong></span>
            </div>
          </div>
          <div class="invoice-summary-metrics">
            <div class="invoice-metric-box blue">
              <span class="label">Total Invoices</span>
              <span class="val">${totalCount} Bills</span>
            </div>
            <div class="invoice-metric-box red">
              <span class="label">Total Bill Amount</span>
              <span class="val">${this.formatMoney(totalAmount)}</span>
            </div>
            <div class="invoice-metric-box emerald">
              <span class="label">Total Collected</span>
              <span class="val">${this.formatMoney(totalAllCollected)}</span>
            </div>
            <div class="invoice-metric-box amber">
              <span class="label">Total Pending</span>
              <span class="val">${this.formatMoney(totalAllPending)}</span>
            </div>
          </div>
        `;
      }
    }

    // Render Table TFoot (Totals Row)
    if (tfoot) {
      let selectionLabel = 'GRAND TOTAL';
      if (selectedCompany && selectedAgent) {
        selectionLabel = `${selectedCompany.name.toUpperCase()} (${selectedAgent.name.toUpperCase()}) TOTAL`;
      } else if (selectedCompany) {
        selectionLabel = `${selectedCompany.name.toUpperCase()} TOTAL`;
      } else if (selectedAgent) {
        selectionLabel = `AGENT ${selectedAgent.name.toUpperCase()} TOTAL`;
      }
      if (monthLabel) {
        selectionLabel += ` [${monthLabel.toUpperCase()}]`;
      }
      if (dateLabel) {
        selectionLabel += ` [${dateLabel.toUpperCase()}]`;
      }

      tfoot.innerHTML = `
        <tr class="table-total-row">
          <td colspan="5" style="text-align: right; font-weight: 700; color: #94a3b8; font-size: 0.85rem;">
            ${selectionLabel} (<span style="color:#38bdf8; font-weight:800;">${totalCount} ${totalCount === 1 ? 'Invoice' : 'Invoices'}</span>):
          </td>
          <td style="font-weight: 800; font-family: 'JetBrains Mono', monospace; color: #f87171; font-size: 1.05rem;">
            ${this.formatMoney(totalAmount)}
          </td>
          <td colspan="3" style="color: #94a3b8; font-size: 0.78rem;">
            ${selectedCompany ? `Collected: <strong style="color:#34d399;">${this.formatMoney(selectedCompany.collected_amount)}</strong> • Pending: <strong style="color:#fbbf24;">${this.formatMoney(selectedCompany.pending_amount)}</strong>` : ''}
          </td>
        </tr>
      `;
    }

    // Render Bottom Summary Bar
    if (bottomSummaryBar) {
      let contextHtml = `Showing <strong>${totalCount} ${totalCount === 1 ? 'Invoice' : 'Invoices'}</strong>`;
      if (selectedCompany) {
        contextHtml += ` for company <strong style="color:#ffffff;">${selectedCompany.name}</strong>`;
      }
      if (selectedAgent) {
        contextHtml += ` assigned to <strong style="color:#38bdf8;">${selectedAgent.name}</strong>`;
      }
      if (monthLabel) {
        contextHtml += ` generated in <strong style="color:#38bdf8;">${monthLabel}</strong>`;
      }
      if (dateLabel) {
        contextHtml += ` for <strong style="color:#c084fc;">${dateLabel}</strong>`;
      }
      if (!selectedCompany && !selectedAgent && !monthLabel && !dateLabel) {
        contextHtml += ` across all accounts`;
      }

      bottomSummaryBar.innerHTML = `
        <div class="summary-left">
          <span>${contextHtml}</span>
        </div>
        <div class="summary-totals">
          <span>Total Number of Invoices: <strong class="highlight-val" style="color:#38bdf8;">${totalCount}</strong></span>
          <span>•</span>
          <span>Total Bill Amount: <strong class="highlight-val" style="color:#f87171; font-size:1.05rem;">${this.formatMoney(totalAmount)}</strong></span>
          ${selectedCompany ? `<span>•</span><span>Remaining Pending: <strong class="highlight-val" style="color:#fbbf24;">${this.formatMoney(selectedCompany.pending_amount)}</strong></span>` : ''}
        </div>
      `;
    }

    if (filtered.length === 0) {
      tbody.innerHTML = '<tr><td colspan="9" style="text-align:center; padding:1.5rem; color:#64748b;">No company bills found matching the selected filters.</td></tr>';
      return;
    }

    tbody.innerHTML = filtered.map(inv => `
      <tr>
        <td><strong style="color:#38bdf8; font-family:'JetBrains Mono',monospace;">${inv.invoice_number}</strong></td>
        <td>${inv.invoice_date}</td>
        <td>${inv.due_date || '-'}</td>
        <td><strong>${inv.company_name}</strong></td>
        <td>
          <span style="display:inline-flex; align-items:center; gap:0.4rem;">
            <span style="width:8px; height:8px; border-radius:50%; background:${inv.agent_color || '#64748b'};"></span>
            <strong>${inv.agent_name || '<em style="color:#94a3b8">Unassigned</em>'}</strong>
          </span>
        </td>
        <td style="color:#f87171; font-weight:800; font-family:'JetBrains Mono',monospace;">${this.formatMoney(inv.amount)}</td>
        <td style="max-width: 220px; color:#94a3b8; font-size:0.78rem;">${inv.notes || '-'}</td>
        <td><span class="metric-badge badge-purple">${inv.created_by || 'Prime User'}</span></td>
        <td style="white-space:nowrap;">
          <button class="btn btn-sm btn-outline-primary" onclick="app.editInvoice(${inv.id})" title="Edit Company Bill / Invoice" style="margin-right:4px; padding:0.25rem 0.5rem; font-size:0.75rem;">
            ✏️ Edit
          </button>
          <button class="btn btn-sm btn-outline-danger" onclick="app.deleteInvoice(${inv.id})" title="Delete Invoice" style="padding:0.25rem 0.5rem; font-size:0.75rem;">
            &times;
          </button>
        </td>
      </tr>
    `).join('');
  }

  // ====================================================================
  // PRIME COMPANIES TABLE
  // ====================================================================
  renderCompaniesTable() {
    const tbody = document.getElementById('companies-table-tbody');
    if (!tbody) return;

    const search = (document.getElementById('company-search')?.value || '').toLowerCase();
    const filterAgent = document.getElementById('filter-company-agent')?.value || '';
    const filterStatus = document.getElementById('filter-company-status')?.value || '';

    const filtered = this.companies.filter(c => {
      const matchSearch = c.name.toLowerCase().includes(search) || (c.contact_person && c.contact_person.toLowerCase().includes(search));
      const matchAgent = !filterAgent || String(c.agent_id) === filterAgent;
      const matchStatus = !filterStatus || c.status === filterStatus;
      return matchSearch && matchAgent && matchStatus;
    });

    if (filtered.length === 0) {
      tbody.innerHTML = '<tr><td colspan="9" style="text-align:center; padding:1.5rem; color:#64748b;">No matching companies found</td></tr>';
      return;
    }

    tbody.innerHTML = filtered.map(c => {
      let statusBadge = '<span class="metric-badge badge-warning">Pending</span>';
      if (c.status === 'Completed') statusBadge = '<span class="metric-badge badge-success">Completed</span>';
      else if (c.status === 'In Progress') statusBadge = '<span class="metric-badge badge-info">In Progress</span>';

      return `
        <tr>
          <td>
            <strong>${c.name}</strong>
            ${c.contact_person ? `<div style="font-size:0.75rem; color:#64748b;">Contact: ${c.contact_person}</div>` : ''}
          </td>
          <td><span class="metric-badge badge-purple">${c.category || 'General'}</span></td>
          <td>
            <span style="display:inline-flex; align-items:center; gap:0.4rem;">
              <span style="width:10px; height:10px; border-radius:50%; background:${c.agent_color || '#64748b'};"></span>
              <strong>${c.agent_name || '<em style="color:#94a3b8">Unassigned</em>'}</strong>
            </span>
          </td>
          <td style="font-weight:700; font-family:'JetBrains Mono',monospace;">${this.formatMoney(c.target_amount)}</td>
          <td style="color:#34d399; font-weight:700; font-family:'JetBrains Mono',monospace;">${this.formatMoney(c.collected_amount)}</td>
          <td style="color:#f87171; font-weight:700; font-family:'JetBrains Mono',monospace;">${this.formatMoney(c.pending_amount)}</td>
          <td style="width: 140px;">
            <div style="font-size:0.75rem; margin-bottom:0.2rem; color:#94a3b8;">${c.progress_percent}%</div>
            <div style="width:100%; height:6px; background:#1e293b; border-radius:3px; overflow:hidden;">
              <div style="width:${Math.min(100, c.progress_percent)}%; height:100%; background:${c.progress_percent >= 100 ? '#10b981' : '#3b82f6'}; border-radius:3px;"></div>
            </div>
          </td>
          <td>${statusBadge}</td>
          <td>
            <div style="display:flex; gap:0.35rem;">
              <button class="btn btn-sm btn-primary" onclick="app.quickAddInvoiceForCompany(${c.id})" title="Issue Bill / Invoice">
                + Bill
              </button>
              <button class="btn btn-sm btn-secondary" onclick="app.editCompany(${c.id})" title="Edit Details & Agent">
                Edit
              </button>
              <button class="btn btn-sm btn-outline-danger" onclick="app.deleteCompany(${c.id})" title="Delete Company">
                &times;
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join('');
  }

  // ====================================================================
  // PRIME AGENTS FLEET
  // ====================================================================
  renderAgentsFleet() {
    const container = document.getElementById('agents-grid-container');
    if (!container) return;

    container.innerHTML = this.agentShare.map(agent => {
      const achRate = Math.min(100, agent.targetAchievementRate);
      const initials = agent.name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();

      return `
        <div class="agent-fleet-card">
          <div>
            <div class="agent-fleet-header">
              <div class="agent-avatar-circle" style="background-color: ${agent.badgeColor};">
                ${initials}
              </div>
              <div class="agent-fleet-meta">
                <h4>${agent.name}</h4>
                <div class="agent-fleet-contact">${agent.email || 'No email'} &bull; ${agent.phone || 'No phone'}</div>
              </div>
            </div>

            <div class="agent-stats-strip">
              <div class="stat-strip-box">
                <div class="stat-strip-label">Total Collected</div>
                <div class="stat-strip-val" style="color:#34d399;">${this.formatMoney(agent.totalCollected)}</div>
              </div>
              <div class="stat-strip-box">
                <div class="stat-strip-label">Assigned Bills Target</div>
                <div class="stat-strip-val">${this.formatMoney(agent.assignedTarget)}</div>
              </div>
              <div class="stat-strip-box">
                <div class="stat-strip-label">Assigned Companies</div>
                <div class="stat-strip-val">${agent.companyCount} accounts</div>
              </div>
              <div class="stat-strip-box">
                <div class="stat-strip-label">Total Rewards</div>
                <div class="stat-strip-val" style="color:#fbbf24;">${this.formatMoney(agent.totalRewards)}</div>
              </div>
            </div>

            <div class="agent-fleet-progress">
              <div class="fleet-progress-label">
                <span>Recovery Goal (${achRate}%)</span>
                <span style="color:#38bdf8; font-weight:700;">${agent.percentageOfTotal}% total share</span>
              </div>
              <div class="fleet-progress-bar">
                <div style="width: ${achRate}%; height:100%; background-color: ${agent.badgeColor}; border-radius:4px;"></div>
              </div>
            </div>
          </div>

          <div class="agent-fleet-actions">
            <button class="btn btn-sm btn-amber flex-1" onclick="app.quickRewardAgent(${agent.id}, '${agent.name}', ${agent.suggestedBonus})">
              🏆 Grant Reward
            </button>
            <button class="btn btn-sm btn-secondary" onclick="app.editAgent(${agent.id})">
              Edit
            </button>
            <button class="btn btn-sm btn-outline-danger" onclick="app.deleteAgent(${agent.id})">
              Delete
            </button>
          </div>
        </div>
      `;
    }).join('');
  }

  // ====================================================================
  // PRIME REWARDS TABLE
  // ====================================================================
  renderRewardsTable() {
    const tbody = document.getElementById('rewards-table-tbody');
    if (!tbody) return;

    if (!this.rewards || this.rewards.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding:1.5rem; color:#64748b;">No agent rewards recorded yet. Use the "+ Grant Agent Reward" button to reward your agents!</td></tr>';
      return;
    }

    tbody.innerHTML = this.rewards.map(r => `
      <tr>
        <td>${r.awarded_date}</td>
        <td>
          <span style="display:inline-flex; align-items:center; gap:0.4rem;">
            <span style="width:10px; height:10px; border-radius:50%; background:${r.agent_color || '#f59e0b'};"></span>
            <strong>${r.agent_name}</strong>
          </span>
        </td>
        <td><span class="metric-badge badge-warning">${r.reward_type}</span></td>
        <td style="color:#fbbf24; font-weight:800; font-family:'JetBrains Mono',monospace;">${this.formatMoney(r.amount)}</td>
        <td style="max-width: 280px;">${r.reason || 'Performance incentive'}</td>
        <td>
          <span class="metric-badge ${r.status === 'Paid' ? 'badge-success' : 'badge-info'}">
            ${r.status}
          </span>
        </td>
        <td>
          <div style="display:flex; gap:0.35rem;">
            ${r.status !== 'Paid' ? `
              <button class="btn btn-sm btn-emerald" onclick="app.markRewardPaid(${r.id})" title="Mark as Paid">
                Mark Paid
              </button>
            ` : ''}
            <button class="btn btn-sm btn-outline-danger" onclick="app.deleteReward(${r.id})" title="Delete Reward">
              &times;
            </button>
          </div>
        </td>
      </tr>
    `).join('');
  }

  // ====================================================================
  // PRIME LEDGER TABLE
  // ====================================================================
  renderLedgerTable() {
    const tbody = document.getElementById('ledger-table-tbody');
    if (!tbody) return;

    const search = (document.getElementById('ledger-search')?.value || '').toLowerCase();
    const filterAgent = document.getElementById('filter-ledger-agent')?.value || '';

    const filtered = this.collections.filter(c => {
      const matchSearch = (c.reference_no && c.reference_no.toLowerCase().includes(search)) ||
                          (c.company_name && c.company_name.toLowerCase().includes(search)) ||
                          (c.agent_name && c.agent_name.toLowerCase().includes(search));
      const matchAgent = !filterAgent || String(c.agent_id) === filterAgent;
      return matchSearch && matchAgent;
    });

    if (filtered.length === 0) {
      tbody.innerHTML = '<tr><td colspan="9" style="text-align:center; padding:1.5rem; color:#64748b;">No collections found matching filter criteria</td></tr>';
      return;
    }

    tbody.innerHTML = filtered.map(c => `
      <tr>
        <td><strong style="color:#818cf8; font-family:'JetBrains Mono',monospace;">${c.reference_no || 'TXN-' + c.id}</strong></td>
        <td>${c.payment_date}</td>
        <td><strong>${c.company_name}</strong></td>
        <td>
          <span style="display:inline-flex; align-items:center; gap:0.4rem;">
            <span style="width:8px; height:8px; border-radius:50%; background:${c.agent_color || '#4f46e5'};"></span>
            ${c.agent_name || 'Unassigned'}
          </span>
        </td>
        <td style="color:#34d399; font-weight:700; font-family:'JetBrains Mono',monospace;">${this.formatMoney(c.amount)}</td>
        <td><span class="metric-badge badge-info">${c.payment_method}</span></td>
        <td><span class="metric-badge badge-purple">${c.recorded_by || 'Prime User'}</span></td>
        <td style="max-width: 200px; color:#94a3b8; font-size:0.78rem;">${c.notes || '-'}</td>
        <td style="white-space:nowrap;">
          <button class="btn btn-sm btn-outline-primary" onclick="app.editCollection(${c.id})" title="Edit Collection Record" style="margin-right:4px; padding:0.25rem 0.5rem; font-size:0.75rem;">
            ✏️ Edit
          </button>
          <button class="btn btn-sm btn-outline-danger" onclick="app.deleteCollection(${c.id})" title="Delete Collection Record" style="padding:0.25rem 0.5rem; font-size:0.75rem;">
            &times;
          </button>
        </td>
      </tr>
    `).join('');
  }

  // ====================================================================
  // AGENT PORTAL DATA LOADING & RENDERING
  // ====================================================================
  async refreshAgentData() {
    if (!this.currentUser || this.currentUser.role !== 'agent') return;

    try {
      if (this.supabase) {
        // Direct Query from Supabase Cloud for this Agent
        const agentId = this.currentUser.id;
        const [compRes, colRes, invRes, rewRes] = await Promise.all([
          this.supabase.from('companies').select('*').eq('agent_id', agentId).order('name'),
          this.supabase.from('collections').select('*, companies(name)').eq('agent_id', agentId).order('payment_date', { ascending: false }),
          this.supabase.from('invoices').select('*, companies!inner(name, agent_id)').eq('companies.agent_id', agentId).order('invoice_date', { ascending: false }),
          this.supabase.from('rewards').select('*').eq('agent_id', agentId).order('awarded_date', { ascending: false })
        ]);

        if (compRes.error) throw compRes.error;
        if (colRes.error) throw colRes.error;
        if (invRes.error) throw invRes.error;
        if (rewRes.error) throw rewRes.error;

        const rawCollections = colRes.data || [];
        const rawInvoices = invRes.data || [];
        const rawRewards = rewRes.data || [];
        const rawCompanies = compRes.data || [];

        // Format collections
        const formattedCollections = rawCollections.map(c => ({
          id: c.id,
          reference_no: c.reference_no,
          payment_date: c.payment_date,
          company_name: c.companies?.name || 'Unknown',
          amount: Number(c.amount || 0),
          payment_method: c.payment_method,
          notes: c.notes
        }));

        // Format invoices
        const formattedInvoices = rawInvoices.map(i => ({
          id: i.id,
          invoice_number: i.invoice_number,
          invoice_date: i.invoice_date,
          due_date: i.due_date,
          company_name: i.companies?.name || 'Unknown',
          amount: Number(i.amount || 0),
          notes: i.notes
        }));

        // Format companies
        const formattedCompanies = rawCompanies.map(c => {
          const compInvoices = rawInvoices.filter(i => Number(i.company_id) === Number(c.id));
          const invSum = compInvoices.reduce((s, i) => s + Number(i.amount || 0), 0);
          const target = Number(c.target_amount) > 0 ? Number(c.target_amount) : invSum;

          const compCollections = rawCollections.filter(col => Number(col.company_id) === Number(c.id));
          const collected = compCollections.reduce((s, col) => s + Number(col.amount || 0), 0);
          const pending = Math.max(0, target - collected);
          const progress = target > 0 ? Number(((collected / target) * 100).toFixed(1)) : 0;
          const status = (collected >= target && target > 0) ? 'Completed' : (collected > 0 ? 'In Progress' : 'Pending');

          return {
            id: c.id,
            name: c.name,
            category: c.category,
            contact_person: c.contact_person,
            contact_phone: c.contact_phone,
            target_amount: target,
            collected_amount: collected,
            pending_amount: pending,
            progress_percent: progress,
            status
          };
        });

        // Compute Agent Totals
        const totalTarget = formattedCompanies.reduce((s, c) => s + c.target_amount, 0);
        const totalCollected = formattedCollections.reduce((s, c) => s + c.amount, 0);
        const pendingAmount = Math.max(0, totalTarget - totalCollected);
        const progressPercent = totalTarget > 0 ? Number(((totalCollected / totalTarget) * 100).toFixed(1)) : 0;
        const totalRewards = rawRewards.reduce((s, r) => s + Number(r.amount || 0), 0);

        let suggestedTier = 'Standard Tier';
        if (progressPercent >= 95) suggestedTier = 'Platinum Elite (5% Bonus)';
        else if (progressPercent >= 85) suggestedTier = 'Gold Tier (3.5% Bonus)';
        else if (progressPercent >= 70) suggestedTier = 'Silver Tier (2% Bonus)';
        else if (progressPercent >= 50) suggestedTier = 'Bronze Tier (1% Bonus)';

        this.agentData = {
          stats: {
            totalTarget,
            totalCollected,
            pendingAmount,
            progressPercent,
            assignedCompanyCount: formattedCompanies.length,
            totalRewards,
            suggestedTier
          },
          companies: formattedCompanies,
          invoices: formattedInvoices,
          collections: formattedCollections,
          rewards: rawRewards
        };

        // Cache companies for collection dropdown
        this.companies = formattedCompanies.map(c => ({
          ...c,
          agent_id: agentId,
          agent_name: this.currentUser.name
        }));

        this.renderAgentData();
        this.populateSelectDropdowns();
      } else {
        // Fallback to local Node.js Server or local seed data
        try {
          const res = await fetch(`/api/agent-dashboard/${this.currentUser.id}`);
          if (!res.ok) throw new Error('Failed to load agent profile');
          this.agentData = await res.json();
        } catch {
          // GitHub Pages / Static fallback for logged-in agent
          const agentId = this.currentUser.id;
          const assignedCompanies = [
            { id: 1, name: 'Apex Logistics Inc.', category: 'Logistics', contact_person: 'Marcus Brody', contact_phone: '+1 (555) 111-2201', target_amount: 35000, collected_amount: 20000, pending_amount: 15000, progress_percent: 57.1, status: 'In Progress' },
            { id: 2, name: 'Nexus Tech Solutions', category: 'Technology', contact_person: 'Sophia Chen', contact_phone: '+1 (555) 111-2202', target_amount: 50000, collected_amount: 35000, pending_amount: 15000, progress_percent: 70.0, status: 'In Progress' }
          ];
          const assignedInvoices = [
            { id: 1, invoice_number: 'INV-2026-101', invoice_date: '2026-10-01', due_date: '2026-10-31', company_name: 'Apex Logistics Inc.', amount: 20000, notes: 'Freight dispatch batch #A1' },
            { id: 2, invoice_number: 'INV-2026-102', invoice_date: '2026-10-08', due_date: '2026-11-08', company_name: 'Apex Logistics Inc.', amount: 15000, notes: 'Interstate logistics dues #B4' },
            { id: 3, invoice_number: 'INV-2026-103', invoice_date: '2026-10-02', due_date: '2026-11-02', company_name: 'Nexus Tech Solutions', amount: 30000, notes: 'Enterprise annual cloud licenses' }
          ];
          const assignedCollections = [
            { id: 1, reference_no: 'TXN-90214', company_name: 'Apex Logistics Inc.', amount: 20000, payment_date: '2026-10-12', payment_method: 'Bank Transfer', notes: 'First installment cleared' },
            { id: 2, reference_no: 'TXN-90288', company_name: 'Nexus Tech Solutions', amount: 35000, payment_date: '2026-10-18', payment_method: 'Wire Transfer', notes: 'Enterprise tranche #1' }
          ];
          this.agentData = {
            stats: {
              totalTarget: 85000,
              totalCollected: 55000,
              pendingAmount: 30000,
              progressPercent: 64.7,
              assignedCompanyCount: 2,
              totalRewards: 500,
              suggestedTier: 'Bronze Tier (1% Bonus)'
            },
            companies: assignedCompanies,
            invoices: assignedInvoices,
            collections: assignedCollections,
            rewards: [{ id: 1, awarded_date: '2026-10-24', reward_type: 'Spot Reward', amount: 500, reason: 'Prompt recovery on Apex Logistics', status: 'Awarded' }]
          };
          this.companies = assignedCompanies.map(c => ({ ...c, agent_id: agentId, agent_name: this.currentUser.name }));
        }
        this.renderAgentData();
        this.populateSelectDropdowns();
      }
    } catch (err) {
      console.error('Error refreshing agent portal:', err);
      this.showToast('Failed to load your agent portfolio', 'error');
    }
  }

  renderAgentData() {
    if (!this.agentData || !this.agentData.stats) return;

    const { stats, companies, invoices, collections, rewards } = this.agentData;

    // Agent Hero Stats
    document.getElementById('agent-stat-target').textContent = this.formatMoney(stats.totalTarget);
    document.getElementById('agent-stat-companies-count').textContent = stats.assignedCompanyCount;
    document.getElementById('agent-stat-collected').textContent = this.formatMoney(stats.totalCollected);
    document.getElementById('agent-stat-pct').textContent = `${stats.progressPercent}% Achieved`;
    document.getElementById('agent-stat-pending').textContent = this.formatMoney(stats.pendingAmount);
    document.getElementById('agent-stat-rewards').textContent = this.formatMoney(stats.totalRewards);
    document.getElementById('agent-stat-tier').textContent = stats.suggestedTier;

    // Agent Progress Bar
    const bar = document.getElementById('agent-progress-bar');
    const text = document.getElementById('agent-progress-text');
    const amounts = document.getElementById('agent-amounts-text');
    const pct = Math.min(100, stats.progressPercent);

    if (bar) bar.style.width = `${pct}%`;
    if (text) text.textContent = `${pct}% of Assigned Goal Achieved`;
    if (amounts) amounts.textContent = `${this.formatMoney(stats.totalCollected)} / ${this.formatMoney(stats.totalTarget)}`;

    // Agent's Assigned Companies Table
    const compTbody = document.getElementById('agent-companies-tbody');
    if (compTbody) {
      if (companies.length === 0) {
        compTbody.innerHTML = '<tr><td colspan="9" style="text-align:center; padding:1.5rem; color:#64748b;">No companies assigned to you currently. Contact Prime User to assign accounts.</td></tr>';
      } else {
        compTbody.innerHTML = companies.map(c => `
          <tr>
            <td><strong>${c.name}</strong></td>
            <td><span class="metric-badge badge-purple">${c.category || 'General'}</span></td>
            <td>${c.contact_person || '-'}</td>
            <td>${c.contact_phone || '-'}</td>
            <td style="font-weight:700; font-family:'JetBrains Mono',monospace;">${this.formatMoney(c.target_amount)}</td>
            <td style="color:#34d399; font-weight:700; font-family:'JetBrains Mono',monospace;">${this.formatMoney(c.collected_amount)}</td>
            <td style="color:#f87171; font-weight:700; font-family:'JetBrains Mono',monospace;">${this.formatMoney(c.pending_amount)}</td>
            <td>
              <span class="metric-badge ${c.status === 'Completed' ? 'badge-success' : (c.status === 'In Progress' ? 'badge-info' : 'badge-warning')}">
                ${c.status}
              </span>
            </td>
            <td>
              <button class="btn btn-sm btn-emerald" onclick="app.openRecordCollectionModal(${c.id})">
                + Collect Money
              </button>
            </td>
          </tr>
        `).join('');
      }
    }

    // Invoices for Agent's Companies (entered by Prime User)
    const invTbody = document.getElementById('agent-invoices-tbody');
    if (invTbody) {
      if (invoices.length === 0) {
        invTbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:1.5rem; color:#64748b;">No bills issued for your assigned companies yet.</td></tr>';
      } else {
        invTbody.innerHTML = invoices.map(inv => `
          <tr>
            <td><strong style="color:#38bdf8; font-family:'JetBrains Mono',monospace;">${inv.invoice_number}</strong></td>
            <td>${inv.invoice_date}</td>
            <td>${inv.due_date || '-'}</td>
            <td><strong>${inv.company_name}</strong></td>
            <td style="color:#f87171; font-weight:800; font-family:'JetBrains Mono',monospace;">${this.formatMoney(inv.amount)}</td>
            <td style="color:#94a3b8; font-size:0.78rem;">${inv.notes || '-'}</td>
          </tr>
        `).join('');
      }
    }

    // Agent's Collection History
    const colTbody = document.getElementById('agent-collections-tbody');
    if (colTbody) {
      if (collections.length === 0) {
        colTbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding:1.5rem; color:#64748b;">No payments entered yet. Click "+ Record Collection" to log money collected!</td></tr>';
      } else {
        colTbody.innerHTML = collections.map(c => `
          <tr>
            <td><strong style="color:#818cf8; font-family:'JetBrains Mono',monospace;">${c.reference_no || 'TXN-' + c.id}</strong></td>
            <td>${c.payment_date}</td>
            <td><strong>${c.company_name}</strong></td>
            <td style="color:#34d399; font-weight:700; font-family:'JetBrains Mono',monospace;">${this.formatMoney(c.amount)}</td>
            <td><span class="metric-badge badge-info">${c.payment_method}</span></td>
            <td style="color:#94a3b8; font-size:0.78rem;">${c.notes || '-'}</td>
            <td style="white-space:nowrap;">
              <button class="btn btn-sm btn-outline-primary" onclick="app.editCollection(${c.id})" title="Edit Collection Record" style="padding:0.25rem 0.5rem; font-size:0.75rem;">
                ✏️ Edit
              </button>
            </td>
          </tr>
        `).join('');
      }
    }

    // Agent's Rewards
    const rewTbody = document.getElementById('agent-rewards-tbody');
    if (rewTbody) {
      if (rewards.length === 0) {
        rewTbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:1.5rem; color:#64748b;">No bonuses awarded yet. Increase your collections to unlock reward milestones!</td></tr>';
      } else {
        rewTbody.innerHTML = rewards.map(r => `
          <tr>
            <td>${r.awarded_date}</td>
            <td><span class="metric-badge badge-warning">${r.reward_type}</span></td>
            <td style="color:#fbbf24; font-weight:800; font-family:'JetBrains Mono',monospace;">${this.formatMoney(r.amount)}</td>
            <td>${r.reason}</td>
            <td><span class="metric-badge badge-success">${r.status}</span></td>
          </tr>
        `).join('');
      }
    }
  }

  // ====================================================================
  // POPULATE DROPDOWNS & FILTERS
  // ====================================================================
  populateSelectDropdowns() {
    // 1. Company dropdown in Invoice Modal (Prime User)
    const invCompSelect = document.getElementById('inv-company-select');
    if (invCompSelect) {
      const cur = invCompSelect.value;
      invCompSelect.innerHTML = '<option value="">-- Choose Company --</option>' +
        this.companies.map(c => `
          <option value="${c.id}" data-agent="${c.agent_name || 'Unassigned'}">
            ${c.name} [Assigned Agent: ${c.agent_name || 'None'}]
          </option>
        `).join('');
      if (cur) invCompSelect.value = cur;
    }

    // 2. Company dropdown in Record Collection Modal
    const colCompanySelect = document.getElementById('col-company-select');
    if (colCompanySelect) {
      const cur = colCompanySelect.value;
      let availableCompanies = this.companies;
      if (this.currentUser?.role === 'agent') {
        availableCompanies = this.companies.filter(c => Number(c.agent_id) === Number(this.currentUser.id));
      }

      colCompanySelect.innerHTML = '<option value="">-- Choose Company --</option>' + 
        availableCompanies.map(c => `
          <option value="${c.id}" data-agent-id="${c.agent_id || ''}" data-pending="${c.pending_amount}" data-target="${c.target_amount}">
            ${c.name} [Pending: ${this.formatMoney(c.pending_amount)}]
          </option>
        `).join('');
      if (cur) colCompanySelect.value = cur;
    }

    // 3. Agent dropdowns
    const agentDropdowns = [
      document.getElementById('comp-agent-assign'),
      document.getElementById('col-agent-select'),
      document.getElementById('reward-agent-select'),
      document.getElementById('filter-company-agent'),
      document.getElementById('filter-ledger-agent'),
      document.getElementById('filter-invoice-agent')
    ];

    agentDropdowns.forEach(dd => {
      if (!dd) return;
      const currentVal = dd.value;
      const isFilter = Boolean(dd.id && dd.id.startsWith('filter-'));
      const firstOpt = isFilter ? '<option value="">All Agents</option>' : '<option value="">-- Choose Agent --</option>';

      dd.innerHTML = firstOpt + this.agentShare.map(a => `
        <option value="${a.id}">${a.name} (${a.percentageOfTotal}% share)</option>
      `).join('');

      if (currentVal) dd.value = currentVal;
    });

    // 4. Company filter in invoice tab
    const filterInvComp = document.getElementById('filter-invoice-company');
    if (filterInvComp) {
      const cur = filterInvComp.value;
      filterInvComp.innerHTML = '<option value="">All Companies</option>' +
        this.companies.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
      if (cur) filterInvComp.value = cur;
    }

    // 5. Monthly invoice generated filter in invoice tab
    const filterInvMonth = document.getElementById('filter-invoice-month');
    if (filterInvMonth) {
      const curMonth = filterInvMonth.value;
      const monthMap = new Map();
      (this.invoices || []).forEach(inv => {
        if (inv.invoice_date && inv.invoice_date.length >= 7) {
          const ym = inv.invoice_date.substring(0, 7);
          monthMap.set(ym, (monthMap.get(ym) || 0) + 1);
        }
      });
      const sortedYm = Array.from(monthMap.keys()).sort().reverse();
      
      let monthOpts = '<option value="">📅 All Months</option>';
      sortedYm.forEach(ym => {
        const [yr, mo] = ym.split('-');
        const dateObj = new Date(Number(yr), Number(mo) - 1, 1);
        const monthName = isNaN(dateObj) ? ym : dateObj.toLocaleString('en-US', { month: 'long', year: 'numeric' });
        const count = monthMap.get(ym);
        monthOpts += `<option value="${ym}">📅 ${monthName} (${count} ${count === 1 ? 'Bill' : 'Bills'})</option>`;
      });
      filterInvMonth.innerHTML = monthOpts;
      if (curMonth && monthMap.has(curMonth)) {
        filterInvMonth.value = curMonth;
      }
    }
  }

  resetInvoiceFilters() {
    const searchInput = document.getElementById('invoice-search');
    const compSelect = document.getElementById('filter-invoice-company');
    const agentSelect = document.getElementById('filter-invoice-agent');
    const monthSelect = document.getElementById('filter-invoice-month');
    const dateFromInput = document.getElementById('filter-invoice-date-from');
    const dateToInput = document.getElementById('filter-invoice-date-to');

    if (searchInput) searchInput.value = '';
    if (compSelect) compSelect.value = '';
    if (agentSelect) agentSelect.value = '';
    if (monthSelect) monthSelect.value = '';
    if (dateFromInput) dateFromInput.value = '';
    if (dateToInput) dateToInput.value = '';

    this.renderInvoicesTable();
    this.showToast('Invoice filters reset to default view.');
  }

  setupFilters() {
    document.getElementById('invoice-search')?.addEventListener('input', () => this.renderInvoicesTable());
    document.getElementById('filter-invoice-company')?.addEventListener('change', () => this.renderInvoicesTable());
    document.getElementById('filter-invoice-agent')?.addEventListener('change', () => this.renderInvoicesTable());
    document.getElementById('filter-invoice-month')?.addEventListener('change', () => this.renderInvoicesTable());
    ['change', 'input'].forEach(evt => {
      document.getElementById('filter-invoice-date-from')?.addEventListener(evt, () => this.renderInvoicesTable());
      document.getElementById('filter-invoice-date-to')?.addEventListener(evt, () => this.renderInvoicesTable());
    });

    document.getElementById('company-search')?.addEventListener('input', () => this.renderCompaniesTable());
    document.getElementById('filter-company-agent')?.addEventListener('change', () => this.renderCompaniesTable());
    document.getElementById('filter-company-status')?.addEventListener('change', () => this.renderCompaniesTable());

    document.getElementById('ledger-search')?.addEventListener('input', () => this.renderLedgerTable());
    document.getElementById('filter-ledger-agent')?.addEventListener('change', () => this.renderLedgerTable());

    document.getElementById('inv-company-select')?.addEventListener('change', (e) => {
      const opt = e.target.selectedOptions[0];
      const agent = opt?.getAttribute('data-agent');
      const help = document.getElementById('inv-company-agent-help');
      if (agent && help) {
        help.textContent = `Assigned Collector Agent: ${agent}. This bill will automatically increase this agent's target.`;
      }
    });

    document.getElementById('col-company-select')?.addEventListener('change', (e) => {
      const opt = e.target.selectedOptions[0];
      if (!opt || !opt.value) {
        document.getElementById('col-company-info').textContent = 'Select a company to view remaining pending dues';
        return;
      }
      const agentId = opt.getAttribute('data-agent-id');
      const pending = opt.getAttribute('data-pending');
      const target = opt.getAttribute('data-target');

      if (agentId && document.getElementById('col-agent-select')) {
        document.getElementById('col-agent-select').value = agentId;
      }

      document.getElementById('col-company-info').innerHTML = `
        Total Invoiced Target: <strong>${this.formatMoney(target)}</strong> | 
        Pending Balance: <strong style="color:#f87171;">${this.formatMoney(pending)}</strong>
      `;

      const amountInput = document.getElementById('col-amount');
      if (amountInput && !amountInput.value) {
        amountInput.placeholder = `e.g. ${pending}`;
      }
    });

    document.getElementById('reward-agent-select')?.addEventListener('change', (e) => {
      const agentId = Number(e.target.value);
      const agent = this.agentShare.find(a => a.id === agentId);
      const hint = document.getElementById('reward-agent-hint');
      if (agent && hint) {
        hint.innerHTML = `
          <strong>${agent.name}</strong> collected <strong>${this.formatMoney(agent.totalCollected)}</strong> (${agent.targetAchievementRate}% of target). 
          Suggested: <strong style="color:#fbbf24;">${agent.suggestedTier} (${this.formatMoney(agent.suggestedBonus)})</strong>
        `;
        const amtInput = document.getElementById('reward-amount');
        if (amtInput && !amtInput.value && agent.suggestedBonus > 0) {
          amtInput.value = agent.suggestedBonus;
        }
      }
    });
  }

  // ====================================================================
  // FORM SUBMISSIONS (HYBRID SUPABASE & LOCAL REST)
  // ====================================================================
  setupForms() {
    // 0. Login Forms
    document.getElementById('form-login-prime')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const u = document.getElementById('prime-username').value;
      const p = document.getElementById('prime-password').value;
      await this.login('prime', u, p);
    });

    document.getElementById('form-login-agent')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const a = document.getElementById('agent-select-login').value;
      const p = document.getElementById('agent-password').value;
      if (!a) {
        this.showToast('Please select your agent profile', 'error');
        return;
      }
      await this.login('agent', a, p);
    });

    // 1. Prime User Adds/Edits Company Bill / Invoice Form
    document.getElementById('form-invoice')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const editId = document.getElementById('inv-edit-id')?.value;
      const companyId = Number(document.getElementById('inv-company-select').value);
      const invoiceNumber = document.getElementById('inv-number').value.trim();
      const amount = parseFloat(document.getElementById('inv-amount').value);
      const invoiceDate = document.getElementById('inv-date').value;
      const dueDate = document.getElementById('inv-due-date').value || null;
      const notes = document.getElementById('inv-notes').value.trim();

      try {
        if (this.supabase) {
          if (editId) {
            const oldInv = this.invoices.find(i => Number(i.id) === Number(editId));
            const oldCompanyId = oldInv ? Number(oldInv.company_id) : null;

            const { error } = await this.supabase.from('invoices').update({
              company_id: companyId,
              invoice_number: invoiceNumber,
              invoice_date: invoiceDate,
              due_date: dueDate,
              amount,
              notes
            }).eq('id', editId);
            if (error) throw new Error(error.message);

            // Update new company target_amount in database
            const { data: invList } = await this.supabase.from('invoices').select('amount').eq('company_id', companyId);
            const newTarget = (invList || []).reduce((s, i) => s + Number(i.amount || 0), 0);
            await this.supabase.from('companies').update({ target_amount: newTarget }).eq('id', companyId);

            // If company changed, also update old company target
            if (oldCompanyId && oldCompanyId !== companyId) {
              const { data: oldInvList } = await this.supabase.from('invoices').select('amount').eq('company_id', oldCompanyId);
              const oldTarget = (oldInvList || []).reduce((s, i) => s + Number(i.amount || 0), 0);
              await this.supabase.from('companies').update({ target_amount: oldTarget }).eq('id', oldCompanyId);
            }
          } else {
            // Direct Supabase Insert
            const { error } = await this.supabase.from('invoices').insert([{
              company_id: companyId,
              invoice_number: invoiceNumber,
              invoice_date: invoiceDate,
              due_date: dueDate,
              amount,
              notes,
              created_by: 'Prime User'
            }]);
            if (error) throw new Error(error.message);

            // Update company target_amount in database
            const { data: invList } = await this.supabase.from('invoices').select('amount').eq('company_id', companyId);
            const newTarget = (invList || []).reduce((s, i) => s + Number(i.amount || 0), 0);
            await this.supabase.from('companies').update({ target_amount: newTarget }).eq('id', companyId);
          }
        } else {
          // Local Node.js REST
          const url = editId ? `/api/invoices/${editId}` : '/api/invoices';
          const method = editId ? 'PUT' : 'POST';
          const res = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              company_id: companyId,
              invoice_number: invoiceNumber,
              invoice_date: invoiceDate,
              due_date: dueDate,
              amount,
              notes,
              created_by: 'Prime User'
            })
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || 'Failed to save invoice');
        }

        this.showToast(editId ? `Invoice ${invoiceNumber} updated and synced!` : `Invoice ${invoiceNumber} (${this.formatMoney(amount)}) issued and synced!`);
        this.closeModal('modal-invoice');
        document.getElementById('form-invoice').reset();
        const editIdEl = document.getElementById('inv-edit-id');
        if (editIdEl) editIdEl.value = '';

        this.broadcastSync('invoices');
        await this.syncAllData();
      } catch (err) {
        this.showToast(err.message, 'error');
      }
    });

    // 2. Record Collection Form (Agent or Prime User)
    document.getElementById('form-record-collection')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const colEditId = document.getElementById('col-edit-id')?.value;
      const companyId = Number(document.getElementById('col-company-select').value);
      let agentId = document.getElementById('col-agent-select')?.value ? Number(document.getElementById('col-agent-select').value) : null;
      let recorder = 'Prime User';

      if (this.currentUser?.role === 'agent') {
        agentId = this.currentUser.id;
        recorder = `Agent: ${this.currentUser.name}`;
      }

      const amount = parseFloat(document.getElementById('col-amount').value);
      const paymentDate = document.getElementById('col-date').value || new Date().toISOString().split('T')[0];
      const paymentMethod = document.getElementById('col-method').value;
      const refNo = document.getElementById('col-ref').value.trim();
      const notes = document.getElementById('col-notes').value.trim();

      try {
        if (this.supabase) {
          if (colEditId) {
            const { error } = await this.supabase.from('collections').update({
              company_id: companyId,
              agent_id: agentId,
              amount,
              payment_date: paymentDate,
              payment_method: paymentMethod,
              reference_no: refNo,
              notes
            }).eq('id', colEditId);
            if (error) throw new Error(error.message);
          } else {
            // Direct Supabase Insert
            const { error } = await this.supabase.from('collections').insert([{
              company_id: companyId,
              agent_id: agentId,
              amount,
              payment_date: paymentDate,
              payment_method: paymentMethod,
              reference_no: refNo,
              notes,
              recorded_by: recorder
            }]);
            if (error) throw new Error(error.message);
          }

          // Update company status & collection amounts
          const { data: colList } = await this.supabase.from('collections').select('amount').eq('company_id', companyId);
          const { data: comp } = await this.supabase.from('companies').select('target_amount').eq('id', companyId).single();
          const collected = (colList || []).reduce((s, c) => s + Number(c.amount || 0), 0);
          const target = comp?.target_amount || 0;
          const status = (collected >= target && target > 0) ? 'Completed' : (collected > 0 ? 'In Progress' : 'Pending');
          await this.supabase.from('companies').update({ status }).eq('id', companyId);
        } else {
          // Local Node.js REST
          const url = colEditId ? `/api/collections/${colEditId}` : '/api/collections';
          const method = colEditId ? 'PUT' : 'POST';
          const res = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              company_id: companyId,
              agent_id: agentId,
              amount,
              payment_date: paymentDate,
              payment_method: paymentMethod,
              reference_no: refNo,
              notes,
              recorded_by: recorder
            })
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || 'Failed to record collection');
        }

        this.showToast(colEditId ? 'Collection entry updated and synced!' : `Collection of ${this.formatMoney(amount)} recorded and synced!`);
        this.closeModal('modal-record-collection');
        document.getElementById('form-record-collection').reset();
        const colEditIdEl = document.getElementById('col-edit-id');
        if (colEditIdEl) colEditIdEl.value = '';

        this.broadcastSync('collections');
        await this.syncAllData();
      } catch (err) {
        this.showToast(err.message, 'error');
      }
    });

    // 3. Company Form
    document.getElementById('form-company')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const editId = document.getElementById('company-edit-id').value;
      const name = document.getElementById('comp-name').value.trim();
      const category = document.getElementById('comp-category').value.trim();
      const agentId = document.getElementById('comp-agent-assign').value ? Number(document.getElementById('comp-agent-assign').value) : null;
      const contactPerson = document.getElementById('comp-contact-person').value.trim();
      const contactPhone = document.getElementById('comp-contact-phone').value.trim();
      const notes = document.getElementById('comp-notes').value.trim();

      const payload = {
        name,
        category,
        agent_id: agentId,
        contact_person: contactPerson,
        contact_phone: contactPhone,
        notes
      };

      try {
        if (this.supabase) {
          if (editId) {
            const { error } = await this.supabase.from('companies').update(payload).eq('id', editId);
            if (error) throw new Error(error.message);
          } else {
            const { error } = await this.supabase.from('companies').insert([{
              ...payload,
              target_amount: 0,
              status: 'Pending'
            }]);
            if (error) throw new Error(error.message);
          }
        } else {
          const url = editId ? `/api/companies/${editId}` : '/api/companies';
          const method = editId ? 'PUT' : 'POST';
          const res = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });
          if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error || 'Failed to save company');
          }
        }

        this.showToast(editId ? `Company "${name}" updated and synced!` : `Company "${name}" added and synced!`);
        this.closeModal('modal-company');
        document.getElementById('form-company').reset();
        this.broadcastSync('companies');
        await this.syncAllData();
      } catch (err) {
        this.showToast(err.message, 'error');
      }
    });

    // 4. Agent Form
    document.getElementById('form-agent')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const editId = document.getElementById('agent-edit-id').value;
      const name = document.getElementById('agent-name').value.trim();
      const email = document.getElementById('agent-email').value.trim();
      const phone = document.getElementById('agent-phone').value.trim();
      const password = document.getElementById('agent-password-input').value.trim() || 'agent123';
      const colorInput = document.querySelector('input[name="agent-color"]:checked');
      const badgeColor = colorInput ? colorInput.value : '#3b82f6';

      const payload = { name, email, phone, badge_color: badgeColor, password };

      try {
        if (this.supabase) {
          if (editId) {
            const { error } = await this.supabase.from('agents').update(payload).eq('id', editId);
            if (error) throw new Error(error.message);
          } else {
            const { error } = await this.supabase.from('agents').insert([{ ...payload, status: 'Active' }]);
            if (error) throw new Error(error.message);
          }
        } else {
          const url = editId ? `/api/agents/${editId}` : '/api/agents';
          const method = editId ? 'PUT' : 'POST';
          const res = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });
          if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error || 'Failed to save agent');
          }
        }

        this.showToast(editId ? `Agent "${name}" updated and synced!` : `Agent "${name}" added and synced!`);
        this.closeModal('modal-agent');
        document.getElementById('form-agent').reset();
        await this.loadAgentsForAuth();
        this.broadcastSync('agents');
        await this.syncAllData();
      } catch (err) {
        this.showToast(err.message, 'error');
      }
    });

    // 5. Reward Form
    document.getElementById('form-reward')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const agentId = Number(document.getElementById('reward-agent-select').value);
      const amount = parseFloat(document.getElementById('reward-amount').value);
      const rewardType = document.getElementById('reward-type').value;
      const status = document.getElementById('reward-status').value;
      const awardedDate = document.getElementById('reward-date').value;
      const reason = document.getElementById('reward-reason').value.trim();

      const payload = {
        agent_id: agentId,
        amount,
        reward_type: rewardType,
        status,
        awarded_date: awardedDate,
        reason
      };

      try {
        if (this.supabase) {
          const { error } = await this.supabase.from('rewards').insert([payload]);
          if (error) throw new Error(error.message);
        } else {
          const res = await fetch('/api/rewards', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });
          if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error || 'Failed to grant reward');
          }
        }

        const agent = this.agents.find(a => Number(a.id) === agentId) || { name: 'Agent' };
        this.showToast(`Reward of ${this.formatMoney(amount)} granted to ${agent.name} and synced!`);
        this.closeModal('modal-reward');
        document.getElementById('form-reward').reset();
        this.broadcastSync('rewards');
        await this.syncAllData();
      } catch (err) {
        this.showToast(err.message, 'error');
      }
    });
  }

  // ====================================================================
  // MODAL OPENERS & ENTITY ACTIONS
  // ====================================================================
  openAddInvoiceModal(companyId = null) {
    const form = document.getElementById('form-invoice');
    if (form) form.reset();
    const editIdEl = document.getElementById('inv-edit-id');
    if (editIdEl) editIdEl.value = '';
    const titleEl = document.getElementById('modal-invoice-title');
    if (titleEl) titleEl.textContent = 'Add Company Bill / Invoice';
    const btnText = document.getElementById('btn-invoice-submit-text');
    if (btnText) btnText.textContent = 'Issue Company Bill';

    document.getElementById('inv-date').value = new Date().toISOString().split('T')[0];
    document.getElementById('inv-number').value = `INV-${new Date().getFullYear()}-${Math.floor(100 + Math.random() * 900)}`;

    this.populateSelectDropdowns();

    if (companyId) {
      document.getElementById('inv-company-select').value = companyId;
      document.getElementById('inv-company-select').dispatchEvent(new Event('change'));
    }

    this.openModal('modal-invoice');
  }

  editInvoice(invoiceId) {
    const inv = this.invoices.find(i => Number(i.id) === Number(invoiceId));
    if (!inv) return;

    this.populateSelectDropdowns();

    const editIdEl = document.getElementById('inv-edit-id');
    if (editIdEl) editIdEl.value = inv.id;

    const select = document.getElementById('inv-company-select');
    if (select) select.value = inv.company_id;

    document.getElementById('inv-number').value = inv.invoice_number;
    document.getElementById('inv-amount').value = inv.amount;
    document.getElementById('inv-date').value = inv.invoice_date;
    document.getElementById('inv-due-date').value = inv.due_date || '';
    document.getElementById('inv-notes').value = inv.notes || '';

    const titleEl = document.getElementById('modal-invoice-title');
    if (titleEl) titleEl.textContent = `Edit Company Bill: ${inv.invoice_number}`;

    const btnText = document.getElementById('btn-invoice-submit-text');
    if (btnText) btnText.textContent = 'Update Company Bill';

    this.openModal('modal-invoice');
  }

  quickAddInvoiceForCompany(companyId) {
    this.openAddInvoiceModal(companyId);
  }

  async deleteInvoice(invoiceId) {
    if (confirm('Delete this company bill/invoice? The company target and assigned agent target will be updated.')) {
      try {
        if (this.supabase) {
          const inv = this.invoices.find(i => Number(i.id) === Number(invoiceId));
          const companyId = inv?.company_id;
          const { error } = await this.supabase.from('invoices').delete().eq('id', invoiceId);
          if (error) throw new Error(error.message);

          if (companyId) {
            const { data: invList } = await this.supabase.from('invoices').select('amount').eq('company_id', companyId);
            const newTarget = (invList || []).reduce((s, i) => s + Number(i.amount || 0), 0);
            await this.supabase.from('companies').update({ target_amount: newTarget }).eq('id', companyId);
          }
        } else {
          const res = await fetch(`/api/invoices/${invoiceId}`, { method: 'DELETE' });
          if (!res.ok) throw new Error('Failed to delete invoice');
        }

        this.showToast('Invoice deleted and company bill updated.');
        this.broadcastSync('invoices');
        await this.syncAllData();
      } catch (err) {
        this.showToast(err.message || 'Failed to delete invoice', 'error');
      }
    }
  }

  openRecordCollectionModal(companyId = null) {
    const form = document.getElementById('form-record-collection');
    if (form) form.reset();
    const colEditIdEl = document.getElementById('col-edit-id');
    if (colEditIdEl) colEditIdEl.value = '';

    document.getElementById('col-date').value = new Date().toISOString().split('T')[0];
    document.getElementById('col-ref').value = `TXN-${Date.now().toString().slice(-6)}`;

    this.populateSelectDropdowns();

    const titleEl = document.getElementById('record-collection-modal-title');
    const agentGroup = document.getElementById('col-agent-select-group');
    const btnText = document.getElementById('btn-col-submit-text');
    if (btnText) btnText.textContent = 'Save Collection Entry';

    if (this.currentUser?.role === 'agent') {
      titleEl.textContent = `Record Collection (${this.currentUser.name})`;
      if (agentGroup) agentGroup.style.display = 'none';
    } else {
      titleEl.textContent = 'Record Company Collection';
      if (agentGroup) agentGroup.style.display = 'block';
    }

    if (companyId) {
      document.getElementById('col-company-select').value = companyId;
      document.getElementById('col-company-select').dispatchEvent(new Event('change'));
    } else {
      document.getElementById('col-company-info').textContent = 'Select a company to view remaining pending dues';
    }

    this.openModal('modal-record-collection');
  }

  editCollection(collectionId) {
    const col = this.collections.find(c => Number(c.id) === Number(collectionId)) || 
                (this.agentData?.collections || []).find(c => Number(c.id) === Number(collectionId));
    if (!col) return;

    this.populateSelectDropdowns();

    const editIdEl = document.getElementById('col-edit-id');
    if (editIdEl) editIdEl.value = col.id;

    const select = document.getElementById('col-company-select');
    if (select) select.value = col.company_id;

    const agSelect = document.getElementById('col-agent-select');
    if (agSelect && col.agent_id) agSelect.value = col.agent_id;

    document.getElementById('col-amount').value = col.amount;
    document.getElementById('col-date').value = col.payment_date || new Date().toISOString().split('T')[0];
    document.getElementById('col-method').value = col.payment_method || 'Bank Transfer';
    document.getElementById('col-ref').value = col.reference_no || '';
    document.getElementById('col-notes').value = col.notes || '';

    const titleEl = document.getElementById('record-collection-modal-title');
    if (titleEl) titleEl.textContent = `Edit Collection: ${col.reference_no || 'TXN-' + col.id}`;

    const btnText = document.getElementById('btn-col-submit-text');
    if (btnText) btnText.textContent = 'Update Collection Entry';

    this.openModal('modal-record-collection');
  }

  openAddCompanyModal() {
    document.getElementById('form-company').reset();
    document.getElementById('company-edit-id').value = '';
    document.getElementById('modal-company-title').textContent = 'Add New Company';
    document.getElementById('btn-save-company').textContent = 'Save Company';
    this.openModal('modal-company');
  }

  editCompany(companyId) {
    const comp = this.companies.find(c => c.id === companyId);
    if (!comp) return;

    document.getElementById('company-edit-id').value = comp.id;
    document.getElementById('comp-name').value = comp.name;
    document.getElementById('comp-category').value = comp.category || '';
    document.getElementById('comp-agent-assign').value = comp.agent_id || '';
    document.getElementById('comp-contact-person').value = comp.contact_person || '';
    document.getElementById('comp-contact-phone').value = comp.contact_phone || '';
    document.getElementById('comp-notes').value = comp.notes || '';

    document.getElementById('modal-company-title').textContent = `Edit Company: ${comp.name}`;
    document.getElementById('btn-save-company').textContent = 'Update Company';
    this.openModal('modal-company');
  }

  async deleteCompany(companyId) {
    const comp = this.companies.find(c => c.id === companyId);
    const name = comp ? comp.name : 'this company';
    if (confirm(`Are you sure you want to delete "${name}"? All associated invoices and collections will be removed.`)) {
      try {
        if (this.supabase) {
          const { error } = await this.supabase.from('companies').delete().eq('id', companyId);
          if (error) throw new Error(error.message);
        } else {
          const res = await fetch(`/api/companies/${companyId}`, { method: 'DELETE' });
          if (!res.ok) throw new Error('Failed to delete company');
        }
        this.showToast(`Company "${name}" deleted.`);
        this.broadcastSync('companies');
        await this.syncAllData();
      } catch (err) {
        this.showToast(err.message || 'Failed to delete company', 'error');
      }
    }
  }

  openAddAgentModal() {
    document.getElementById('form-agent').reset();
    document.getElementById('agent-edit-id').value = '';
    document.getElementById('modal-agent-title').textContent = 'Add New Collection Agent';
    document.getElementById('btn-save-agent').textContent = 'Save Agent';
    this.openModal('modal-agent');
  }

  editAgent(agentId) {
    const agent = this.agentShare.find(a => a.id === agentId);
    if (!agent) return;

    document.getElementById('agent-edit-id').value = agent.id;
    document.getElementById('agent-name').value = agent.name;
    document.getElementById('agent-email').value = agent.email || '';
    document.getElementById('agent-phone').value = agent.phone || '';

    const colorRadio = document.querySelector(`input[name="agent-color"][value="${agent.badgeColor}"]`);
    if (colorRadio) colorRadio.checked = true;

    document.getElementById('modal-agent-title').textContent = `Edit Agent: ${agent.name}`;
    document.getElementById('btn-save-agent').textContent = 'Update Agent';
    this.openModal('modal-agent');
  }

  async deleteAgent(agentId) {
    const agent = this.agentShare.find(a => a.id === agentId);
    const name = agent ? agent.name : 'this agent';
    if (confirm(`Are you sure you want to delete agent "${name}"? Assigned companies will become unassigned.`)) {
      try {
        if (this.supabase) {
          await this.supabase.from('companies').update({ agent_id: null }).eq('agent_id', agentId);
          const { error } = await this.supabase.from('agents').delete().eq('id', agentId);
          if (error) throw new Error(error.message);
        } else {
          const res = await fetch(`/api/agents/${agentId}`, { method: 'DELETE' });
          if (!res.ok) throw new Error('Failed to delete agent');
        }
        this.showToast(`Agent "${name}" deleted.`);
        await this.loadAgentsForAuth();
        this.broadcastSync('agents');
        await this.syncAllData();
      } catch (err) {
        this.showToast(err.message || 'Failed to delete agent', 'error');
      }
    }
  }

  openGrantRewardModal(prefillAgentId = null, prefillAmount = null) {
    document.getElementById('form-reward').reset();
    document.getElementById('reward-date').value = new Date().toISOString().split('T')[0];

    if (prefillAgentId) {
      document.getElementById('reward-agent-select').value = prefillAgentId;
      document.getElementById('reward-agent-select').dispatchEvent(new Event('change'));
    } else {
      document.getElementById('reward-agent-hint').textContent = 'Select an agent to see their collection performance and suggested bonus';
    }

    if (prefillAmount) {
      document.getElementById('reward-amount').value = prefillAmount;
    }

    this.openModal('modal-reward');
  }

  quickRewardAgent(agentId, agentName, suggestedBonus) {
    this.openGrantRewardModal(agentId, suggestedBonus || 1000);
    document.getElementById('reward-reason').value = `Awarded by Prime User for stellar collection performance`;
  }

  async markRewardPaid(rewardId) {
    try {
      if (this.supabase) {
        const { error } = await this.supabase.from('rewards').update({ status: 'Paid' }).eq('id', rewardId);
        if (error) throw new Error(error.message);
      } else {
        const res = await fetch(`/api/rewards/${rewardId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'Paid' })
        });
        if (!res.ok) throw new Error('Failed to update reward');
      }
      this.showToast('Reward marked as Paid!');
      this.broadcastSync('rewards');
      await this.syncAllData();
    } catch (err) {
      this.showToast(err.message || 'Failed to update reward status', 'error');
    }
  }

  async deleteReward(rewardId) {
    if (confirm('Delete this reward record?')) {
      try {
        if (this.supabase) {
          const { error } = await this.supabase.from('rewards').delete().eq('id', rewardId);
          if (error) throw new Error(error.message);
        } else {
          const res = await fetch(`/api/rewards/${rewardId}`, { method: 'DELETE' });
          if (!res.ok) throw new Error('Failed to delete reward');
        }
        this.showToast('Reward deleted.');
        this.broadcastSync('rewards');
        await this.syncAllData();
      } catch (err) {
        this.showToast(err.message || 'Failed to delete reward', 'error');
      }
    }
  }

  async deleteCollection(collectionId) {
    if (confirm('Are you sure you want to remove this collection entry? Company balance will be adjusted accordingly.')) {
      try {
        if (this.supabase) {
          const col = this.collections.find(c => Number(c.id) === Number(collectionId));
          const companyId = col?.company_id;
          const { error } = await this.supabase.from('collections').delete().eq('id', collectionId);
          if (error) throw new Error(error.message);

          if (companyId) {
            const { data: colList } = await this.supabase.from('collections').select('amount').eq('company_id', companyId);
            const { data: comp } = await this.supabase.from('companies').select('target_amount').eq('id', companyId).single();
            const collected = (colList || []).reduce((s, c) => s + Number(c.amount || 0), 0);
            const target = comp?.target_amount || 0;
            const status = (collected >= target && target > 0) ? 'Completed' : (collected > 0 ? 'In Progress' : 'Pending');
            await this.supabase.from('companies').update({ status }).eq('id', companyId);
          }
        } else {
          const res = await fetch(`/api/collections/${collectionId}`, { method: 'DELETE' });
          if (!res.ok) throw new Error('Failed to delete collection');
        }
        this.showToast('Collection record deleted.');
        this.broadcastSync('collections');
        await this.syncAllData();
      } catch (err) {
        this.showToast(err.message || 'Failed to delete collection record', 'error');
      }
    }
  }
}

// Global App Instance & Resilient Initialization
let app;
function initNexusApp() {
  if (!window.nexusApp) {
    app = new CollectionApp();
    window.nexusApp = app;
    window.app = app;
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initNexusApp);
} else {
  initNexusApp();
}

// app.js - Multi-Role Client Logic for Prime User & Agents with Invoice Billing

class CollectionApp {
  constructor() {
    this.currency = localStorage.getItem('nexus_currency') || '$';
    this.currentUser = JSON.parse(localStorage.getItem('nexus_user') || 'null');
    
    // Prime Data
    this.stats = null;
    this.agentShare = [];
    this.companies = [];
    this.agents = [];
    this.collections = [];
    this.rewards = [];
    this.invoices = [];
    this.hoveredSliceIndex = -1;

    // Agent Portal Data
    this.agentData = null;

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

    window.addEventListener('resize', () => {
      if (this.currentUser?.role === 'prime') {
        this.drawPieChart();
      }
    });

    await this.loadAgentsForAuth();
    await this.checkDatabaseStatus();

    if (this.currentUser) {
      this.applyUserSession();
    } else {
      this.showLoginOverlay();
    }
  }

  async checkDatabaseStatus() {
    try {
      const res = await fetch('/api/system/status');
      const data = await res.json();
      const dot = document.getElementById('db-dot');
      const text = document.getElementById('db-status-text');
      if (data.supabaseConnected) {
        if (dot) dot.classList.add('supabase');
        if (text) text.textContent = 'Supabase Cloud';
      } else {
        if (dot) dot.classList.remove('supabase');
        if (text) text.textContent = 'Local SQLite';
      }
    } catch {}
  }

  // ----------------- AUTHENTICATION -----------------
  async loadAgentsForAuth() {
    try {
      const res = await fetch('/api/auth/agents-list');
      const agents = await res.json();
      this.agents = agents;

      const select = document.getElementById('agent-select-login');
      if (select) {
        select.innerHTML = '<option value="">-- Choose Agent --</option>' +
          agents.map(a => `<option value="${a.id}">${a.name} (${a.email})</option>`).join('');
      }

      const chipsContainer = document.getElementById('quick-agent-login-chips');
      if (chipsContainer) {
        chipsContainer.innerHTML = agents.map(a => `
          <button type="button" class="quick-agent-chip" onclick="app.quickLoginAgent(${a.id})">
            <span style="color:${a.badgeColor}">●</span> ${a.name.split(' ')[0]}
          </button>
        `).join('');
      }
    } catch (err) {
      console.error('Failed to load agents for login:', err);
    }
  }

  showLoginOverlay() {
    document.getElementById('auth-overlay').style.display = 'flex';
    document.getElementById('app').style.display = 'none';
  }

  hideLoginOverlay() {
    document.getElementById('auth-overlay').style.display = 'none';
    document.getElementById('app').style.display = 'flex';
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
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role, identifier, password })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Login failed');
      }

      this.currentUser = data.user;
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

  // ----------------- CURRENCY FORMATTING -----------------
  formatMoney(amount) {
    const num = Number(amount || 0);
    return `${this.currency}${num.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
  }

  setupCurrencySelector() {
    const selector = document.getElementById('currency-select');
    if (selector) {
      selector.value = this.currency;
      selector.addEventListener('change', (e) => {
        this.currency = e.target.value;
        localStorage.setItem('nexus_currency', this.currency);
        document.querySelectorAll('.currency-symbol').forEach(el => el.textContent = this.currency);
        if (this.currentUser?.role === 'prime') {
          this.renderPrimeData();
        } else if (this.currentUser?.role === 'agent') {
          this.renderAgentData();
        }
      });
    }
    document.querySelectorAll('.currency-symbol').forEach(el => el.textContent = this.currency);
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

    // Export CSV
    document.getElementById('btn-export-csv')?.addEventListener('click', () => {
      window.location.href = '/api/export/csv';
      this.showToast('Downloading Collections Audit Report CSV...', 'info');
    });
  }

  // ----------------- PRIME DATA LOADING & RENDERING -----------------
  async refreshAllPrimeData() {
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

      this.renderPrimeData();
    } catch (err) {
      console.error('Error refreshing prime data:', err);
      this.showToast('Failed to load server data', 'error');
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

  // ----------------- PIE CHART (HTML5 CANVAS) -----------------
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
      ctx.fillText('No collection data recorded', centerX, centerY);
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

  // ----------------- PRIME INVOICES TABLE -----------------
  renderInvoicesTable() {
    const tbody = document.getElementById('invoices-table-tbody');
    if (!tbody) return;

    const search = (document.getElementById('invoice-search')?.value || '').toLowerCase();
    const filterCompany = document.getElementById('filter-invoice-company')?.value || '';
    const filterAgent = document.getElementById('filter-invoice-agent')?.value || '';

    const filtered = this.invoices.filter(inv => {
      const matchSearch = inv.invoice_number.toLowerCase().includes(search) ||
                          inv.company_name.toLowerCase().includes(search) ||
                          (inv.agent_name && inv.agent_name.toLowerCase().includes(search));
      const matchCompany = !filterCompany || String(inv.company_id) === filterCompany;
      const matchAgent = !filterAgent || String(inv.agent_id) === filterAgent;
      return matchSearch && matchCompany && matchAgent;
    });

    if (filtered.length === 0) {
      tbody.innerHTML = '<tr><td colspan="9" style="text-align:center; padding:1.5rem; color:#64748b;">No company bills found. Click "+ Add Company Bill / Invoice" to enter new bills.</td></tr>';
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
        <td>
          <button class="btn btn-sm btn-outline-danger" onclick="app.deleteInvoice(${inv.id})" title="Delete Invoice">
            &times;
          </button>
        </td>
      </tr>
    `).join('');
  }

  // ----------------- PRIME COMPANIES TABLE -----------------
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

  // ----------------- PRIME AGENTS FLEET -----------------
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

  // ----------------- PRIME REWARDS TABLE -----------------
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

  // ----------------- PRIME LEDGER TABLE -----------------
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
        <td>
          <button class="btn btn-sm btn-outline-danger" onclick="app.deleteCollection(${c.id})" title="Delete Collection Record">
            &times;
          </button>
        </td>
      </tr>
    `).join('');
  }

  // ----------------- AGENT PORTAL DATA LOADING & RENDERING -----------------
  async refreshAgentData() {
    if (!this.currentUser || this.currentUser.role !== 'agent') return;

    try {
      const res = await fetch(`/api/agent-dashboard/${this.currentUser.id}`);
      if (!res.ok) throw new Error('Failed to load agent profile');
      this.agentData = await res.json();
      this.renderAgentData();
    } catch (err) {
      console.error('Error refreshing agent portal:', err);
      this.showToast('Failed to load your agent portfolio', 'error');
    }
  }

  renderAgentData() {
    if (!this.agentData) return;

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
        colTbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:1.5rem; color:#64748b;">No payments entered yet. Click "+ Record Collection" to log money collected!</td></tr>';
      } else {
        colTbody.innerHTML = collections.map(c => `
          <tr>
            <td><strong style="color:#818cf8; font-family:'JetBrains Mono',monospace;">${c.reference_no || 'TXN-' + c.id}</strong></td>
            <td>${c.payment_date}</td>
            <td><strong>${c.company_name}</strong></td>
            <td style="color:#34d399; font-weight:700; font-family:'JetBrains Mono',monospace;">${this.formatMoney(c.amount)}</td>
            <td><span class="metric-badge badge-info">${c.payment_method}</span></td>
            <td style="color:#94a3b8; font-size:0.78rem;">${c.notes || '-'}</td>
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

  // ----------------- POPULATE DROPDOWNS -----------------
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
    // If agent is logged in, ONLY show companies assigned to this agent!
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
      document.getElementById('col-agent-select'),
      document.getElementById('comp-agent-assign'),
      document.getElementById('reward-agent-select'),
      document.getElementById('filter-company-agent'),
      document.getElementById('filter-ledger-agent'),
      document.getElementById('filter-invoice-agent')
    ];

    agentDropdowns.forEach(dd => {
      if (!dd) return;
      const currentVal = dd.value;
      const isFilter = dd.id.startsWith('filter-');
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
  }

  setupFilters() {
    // Invoices table search & filter
    document.getElementById('invoice-search')?.addEventListener('input', () => this.renderInvoicesTable());
    document.getElementById('filter-invoice-company')?.addEventListener('change', () => this.renderInvoicesTable());
    document.getElementById('filter-invoice-agent')?.addEventListener('change', () => this.renderInvoicesTable());

    // Companies table search & filter
    document.getElementById('company-search')?.addEventListener('input', () => this.renderCompaniesTable());
    document.getElementById('filter-company-agent')?.addEventListener('change', () => this.renderCompaniesTable());
    document.getElementById('filter-company-status')?.addEventListener('change', () => this.renderCompaniesTable());

    // Ledger table search & filter
    document.getElementById('ledger-search')?.addEventListener('input', () => this.renderLedgerTable());
    document.getElementById('filter-ledger-agent')?.addEventListener('change', () => this.renderLedgerTable());

    // Invoice modal company selection hint
    document.getElementById('inv-company-select')?.addEventListener('change', (e) => {
      const opt = e.target.selectedOptions[0];
      const agent = opt?.getAttribute('data-agent');
      const help = document.getElementById('inv-company-agent-help');
      if (agent && help) {
        help.textContent = `Assigned Collector Agent: ${agent}. This bill will automatically increase this agent's target.`;
      }
    });

    // Collection modal company selection
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

    // Reward modal agent selection
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

  // ----------------- FORM SUBMISSIONS -----------------
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

    // 1. Prime User Adds Company Bill / Invoice Form
    document.getElementById('form-invoice')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const companyId = document.getElementById('inv-company-select').value;
      const invoiceNumber = document.getElementById('inv-number').value;
      const amount = parseFloat(document.getElementById('inv-amount').value);
      const invoiceDate = document.getElementById('inv-date').value;
      const dueDate = document.getElementById('inv-due-date').value;
      const notes = document.getElementById('inv-notes').value;

      try {
        const res = await fetch('/api/invoices', {
          method: 'POST',
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
        if (!res.ok) throw new Error(data.error || 'Failed to issue invoice');

        this.showToast(`Invoice ${invoiceNumber} (${this.formatMoney(amount)}) issued! Company dues updated.`);
        this.closeModal('modal-invoice');
        document.getElementById('form-invoice').reset();
        await this.refreshAllPrimeData();
      } catch (err) {
        this.showToast(err.message, 'error');
      }
    });

    // 2. Record Collection Form (Agent or Prime User)
    document.getElementById('form-record-collection')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const companyId = document.getElementById('col-company-select').value;
      let agentId = document.getElementById('col-agent-select')?.value || null;
      let recorder = 'Prime User';

      if (this.currentUser?.role === 'agent') {
        agentId = this.currentUser.id;
        recorder = `Agent: ${this.currentUser.name}`;
      }

      const amount = parseFloat(document.getElementById('col-amount').value);
      const paymentDate = document.getElementById('col-date').value;
      const paymentMethod = document.getElementById('col-method').value;
      const refNo = document.getElementById('col-ref').value;
      const notes = document.getElementById('col-notes').value;

      try {
        const res = await fetch('/api/collections', {
          method: 'POST',
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

        this.showToast(`Collection of ${this.formatMoney(amount)} successfully recorded!`);
        this.closeModal('modal-record-collection');
        document.getElementById('form-record-collection').reset();

        if (this.currentUser?.role === 'prime') {
          await this.refreshAllPrimeData();
        } else {
          await this.refreshAgentData();
        }
      } catch (err) {
        this.showToast(err.message, 'error');
      }
    });

    // 3. Company Form
    document.getElementById('form-company')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const editId = document.getElementById('company-edit-id').value;
      const name = document.getElementById('comp-name').value;
      const category = document.getElementById('comp-category').value;
      const agentId = document.getElementById('comp-agent-assign').value || null;
      const contactPerson = document.getElementById('comp-contact-person').value;
      const contactPhone = document.getElementById('comp-contact-phone').value;
      const notes = document.getElementById('comp-notes').value;

      const payload = {
        name,
        category,
        agent_id: agentId,
        contact_person: contactPerson,
        contact_phone: contactPhone,
        notes
      };

      try {
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

        this.showToast(editId ? `Company "${name}" updated!` : `Company "${name}" added!`);
        this.closeModal('modal-company');
        document.getElementById('form-company').reset();
        await this.refreshAllPrimeData();
      } catch (err) {
        this.showToast(err.message, 'error');
      }
    });

    // 4. Agent Form
    document.getElementById('form-agent')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const editId = document.getElementById('agent-edit-id').value;
      const name = document.getElementById('agent-name').value;
      const email = document.getElementById('agent-email').value;
      const phone = document.getElementById('agent-phone').value;
      const password = document.getElementById('agent-password-input').value;
      const colorInput = document.querySelector('input[name="agent-color"]:checked');
      const badgeColor = colorInput ? colorInput.value : '#3b82f6';

      const payload = { name, email, phone, badge_color: badgeColor, password };

      try {
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

        this.showToast(editId ? `Agent "${name}" updated!` : `Agent "${name}" added!`);
        this.closeModal('modal-agent');
        document.getElementById('form-agent').reset();
        await this.loadAgentsForAuth();
        await this.refreshAllPrimeData();
      } catch (err) {
        this.showToast(err.message, 'error');
      }
    });

    // 5. Reward Form
    document.getElementById('form-reward')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const agentId = document.getElementById('reward-agent-select').value;
      const amount = parseFloat(document.getElementById('reward-amount').value);
      const rewardType = document.getElementById('reward-type').value;
      const status = document.getElementById('reward-status').value;
      const awardedDate = document.getElementById('reward-date').value;
      const reason = document.getElementById('reward-reason').value;

      try {
        const res = await fetch('/api/rewards', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            agent_id: agentId,
            amount,
            reward_type: rewardType,
            status,
            awarded_date: awardedDate,
            reason
          })
        });

        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || 'Failed to grant reward');
        }

        this.showToast(`Reward of ${this.formatMoney(amount)} granted!`);
        this.closeModal('modal-reward');
        document.getElementById('form-reward').reset();
        await this.refreshAllPrimeData();
      } catch (err) {
        this.showToast(err.message, 'error');
      }
    });
  }

  // ----------------- MODAL OPENERS -----------------
  openAddInvoiceModal(companyId = null) {
    document.getElementById('form-invoice').reset();
    document.getElementById('inv-date').value = new Date().toISOString().split('T')[0];
    document.getElementById('inv-number').value = `INV-${Date.now().toString().slice(-6)}`;

    if (companyId) {
      document.getElementById('inv-company-select').value = companyId;
      document.getElementById('inv-company-select').dispatchEvent(new Event('change'));
    }

    this.openModal('modal-invoice');
  }

  quickAddInvoiceForCompany(companyId) {
    this.openAddInvoiceModal(companyId);
  }

  async deleteInvoice(invoiceId) {
    if (confirm('Delete this company bill/invoice? The company target and assigned agent target will be updated.')) {
      try {
        const res = await fetch(`/api/invoices/${invoiceId}`, { method: 'DELETE' });
        if (res.ok) {
          this.showToast('Invoice deleted and company bill updated.');
          await this.refreshAllPrimeData();
        }
      } catch (err) {
        this.showToast('Failed to delete invoice', 'error');
      }
    }
  }

  openRecordCollectionModal(companyId = null) {
    document.getElementById('form-record-collection').reset();
    document.getElementById('col-date').value = new Date().toISOString().split('T')[0];
    document.getElementById('col-ref').value = `TXN-${Date.now().toString().slice(-6)}`;

    // Re-populate company dropdown according to role
    this.populateSelectDropdowns();

    const titleEl = document.getElementById('record-collection-modal-title');
    const agentGroup = document.getElementById('col-agent-select-group');

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
        const res = await fetch(`/api/companies/${companyId}`, { method: 'DELETE' });
        if (res.ok) {
          this.showToast(`Company "${name}" deleted.`);
          await this.refreshAllPrimeData();
        }
      } catch (err) {
        this.showToast('Failed to delete company', 'error');
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
        const res = await fetch(`/api/agents/${agentId}`, { method: 'DELETE' });
        if (res.ok) {
          this.showToast(`Agent "${name}" deleted.`);
          await this.loadAgentsForAuth();
          await this.refreshAllPrimeData();
        }
      } catch (err) {
        this.showToast('Failed to delete agent', 'error');
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
      const res = await fetch(`/api/rewards/${rewardId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'Paid' })
      });
      if (res.ok) {
        this.showToast('Reward marked as Paid!');
        await this.refreshAllPrimeData();
      }
    } catch (err) {
      this.showToast('Failed to update reward status', 'error');
    }
  }

  async deleteReward(rewardId) {
    if (confirm('Delete this reward record?')) {
      try {
        const res = await fetch(`/api/rewards/${rewardId}`, { method: 'DELETE' });
        if (res.ok) {
          this.showToast('Reward deleted.');
          await this.refreshAllPrimeData();
        }
      } catch (err) {
        this.showToast('Failed to delete reward', 'error');
      }
    }
  }

  async deleteCollection(collectionId) {
    if (confirm('Are you sure you want to remove this collection entry? Company balance will be adjusted accordingly.')) {
      try {
        const res = await fetch(`/api/collections/${collectionId}`, { method: 'DELETE' });
        if (res.ok) {
          this.showToast('Collection record deleted.');
          if (this.currentUser?.role === 'prime') {
            await this.refreshAllPrimeData();
          } else {
            await this.refreshAgentData();
          }
        }
      } catch (err) {
        this.showToast('Failed to delete collection record', 'error');
      }
    }
  }
}

// Global App Instance
let app;
window.addEventListener('DOMContentLoaded', () => {
  app = new CollectionApp();
});

// db.js - Smart Hybrid Database Manager
// Supports Supabase Cloud PostgreSQL (via db_supabase.js) with seamless fallback to Local SQLite

const fs = require('node:fs');
const path = require('node:path');

// Auto-load .env if available
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath) && typeof process.loadEnvFile === 'function') {
  try {
    process.loadEnvFile(envPath);
  } catch (e) {}
}

const supabase = require('./db_supabase.js');

// ----------------- LOCAL SQLITE ENGINE -----------------
const { DatabaseSync } = require('node:sqlite');
const DB_FILE = path.join(__dirname, 'collection_system.sqlite');
const db = new DatabaseSync(DB_FILE);

db.exec('PRAGMA foreign_keys = ON;');
db.exec('PRAGMA journal_mode = WAL;');

function initDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS agents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      phone TEXT,
      password TEXT DEFAULT 'agent123',
      badge_color TEXT DEFAULT '#3b82f6',
      status TEXT DEFAULT 'Active',
      created_at TEXT DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS companies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      contact_person TEXT,
      contact_phone TEXT,
      category TEXT DEFAULT 'Enterprise',
      target_amount REAL NOT NULL DEFAULT 0,
      agent_id INTEGER REFERENCES agents(id) ON DELETE SET NULL,
      status TEXT DEFAULT 'Pending',
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS invoices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      invoice_number TEXT NOT NULL UNIQUE,
      invoice_date TEXT NOT NULL,
      due_date TEXT,
      amount REAL NOT NULL,
      notes TEXT,
      created_by TEXT DEFAULT 'Prime User',
      created_at TEXT DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS collections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      agent_id INTEGER REFERENCES agents(id) ON DELETE SET NULL,
      invoice_id INTEGER REFERENCES invoices(id) ON DELETE SET NULL,
      amount REAL NOT NULL,
      payment_date TEXT NOT NULL,
      payment_method TEXT DEFAULT 'Bank Transfer',
      reference_no TEXT,
      notes TEXT,
      recorded_by TEXT DEFAULT 'Prime User',
      created_at TEXT DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS rewards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      amount REAL NOT NULL,
      reward_type TEXT DEFAULT 'Performance Bonus',
      reason TEXT,
      status TEXT DEFAULT 'Awarded',
      awarded_date TEXT DEFAULT (datetime('now', 'localtime')),
      created_at TEXT DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS reward_tiers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tier_name TEXT NOT NULL,
      min_percentage REAL NOT NULL,
      rate_percent REAL NOT NULL,
      badge_name TEXT,
      description TEXT
    );
  `);

  try { db.exec("ALTER TABLE agents ADD COLUMN password TEXT DEFAULT 'agent123';"); } catch {}
  try { db.exec("ALTER TABLE collections ADD COLUMN invoice_id INTEGER REFERENCES invoices(id) ON DELETE SET NULL;"); } catch {}

  const agentCount = db.prepare('SELECT COUNT(*) as count FROM agents').get().count;
  const invoiceCount = db.prepare('SELECT COUNT(*) as count FROM invoices').get().count;
  if (agentCount === 0 || invoiceCount === 0) {
    seedInitialData();
  }
}

function syncCompanyTargetFromInvoices(companyId) {
  const sumRow = db.prepare('SELECT COALESCE(SUM(amount), 0) as total FROM invoices WHERE company_id = ?').get(companyId);
  const totalInvoiced = sumRow ? sumRow.total : 0;
  db.prepare('UPDATE companies SET target_amount = ? WHERE id = ?').run(totalInvoiced, companyId);
  updateCompanyStatus(companyId);
}

function updateCompanyStatus(companyId) {
  const company = db.prepare('SELECT target_amount FROM companies WHERE id = ?').get(companyId);
  if (!company) return;

  const collectionRow = db.prepare('SELECT COALESCE(SUM(amount), 0) as collected FROM collections WHERE company_id = ?').get(companyId);
  const collected = collectionRow ? collectionRow.collected : 0;
  
  let newStatus = 'Pending';
  if (collected >= company.target_amount && company.target_amount > 0) {
    newStatus = 'Completed';
  } else if (collected > 0) {
    newStatus = 'In Progress';
  }

  db.prepare('UPDATE companies SET status = ? WHERE id = ?').run(newStatus, companyId);
}

function seedInitialData() {
  db.exec(`
    DELETE FROM rewards;
    DELETE FROM collections;
    DELETE FROM invoices;
    DELETE FROM companies;
    DELETE FROM agents;
    DELETE FROM reward_tiers;
  `);

  const insertAgent = db.prepare(`
    INSERT INTO agents (name, email, phone, password, badge_color, status)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const agentsData = [
    ['Alex Mercer', 'alex.mercer@collections.com', '+1 (555) 234-5671', 'agent123', '#3b82f6', 'Active'],
    ['Brenda Vance', 'brenda.vance@collections.com', '+1 (555) 345-6782', 'agent123', '#10b981', 'Active'],
    ['Carlos Mendez', 'carlos.m@collections.com', '+1 (555) 456-7893', 'agent123', '#f59e0b', 'Active'],
    ['Diana Prince', 'diana.p@collections.com', '+1 (555) 567-8904', 'agent123', '#ec4899', 'Active'],
    ['Evan Wright', 'evan.w@collections.com', '+1 (555) 678-9015', 'agent123', '#8b5cf6', 'Active']
  ];

  const agentIds = [];
  for (const agent of agentsData) {
    const res = insertAgent.run(...agent);
    agentIds.push(res.lastInsertRowid);
  }

  const insertCompany = db.prepare(`
    INSERT INTO companies (name, contact_person, contact_phone, category, target_amount, agent_id, status, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const companiesData = [
    ['Apex Logistics Inc.', 'Marcus Brody', '+1 (555) 111-2201', 'Logistics', 0, agentIds[0], 'In Progress', 'Quarterly freight dues'],
    ['Nexus Tech Solutions', 'Sophia Chen', '+1 (555) 111-2202', 'Technology', 0, agentIds[0], 'In Progress', 'Enterprise software licensing'],
    ['Global Retail Brands', 'David Kim', '+1 (555) 222-3301', 'Retail', 0, agentIds[1], 'In Progress', 'Inventory credit line settlement'],
    ['Horizon Media Network', 'Rachel Green', '+1 (555) 222-3302', 'Media & Ads', 0, agentIds[1], 'In Progress', 'Q3 Digital ad campaign payments'],
    ['Quantum Manufacturing', 'Heinrich Becker', '+1 (555) 333-4401', 'Manufacturing', 0, agentIds[2], 'In Progress', 'Raw materials bulk financing'],
    ['Vertex Financial Group', 'Elena Rostov', '+1 (555) 333-4402', 'Finance', 0, agentIds[2], 'In Progress', 'Consulting & audit services'],
    ['Stellar Pharma Labs', 'Dr. Arthur Pendelton', '+1 (555) 444-5501', 'Healthcare', 0, agentIds[3], 'In Progress', 'Bio-tech medical equipment financing'],
    ['BlueWave Maritime', 'Captain Nathan Ortiz', '+1 (555) 444-5502', 'Shipping', 0, agentIds[3], 'In Progress', 'Harbor handling and container fees'],
    ['Titan Construction Works', 'Frank Castle', '+1 (555) 555-6601', 'Infrastructure', 0, agentIds[4], 'In Progress', 'Commercial tower procurement'],
    ['Aurora Clean Energy', 'Dr. Lisa Wong', '+1 (555) 555-6602', 'Renewables', 0, agentIds[4], 'In Progress', 'Solar turbine leasing']
  ];

  const companyIds = [];
  for (const company of companiesData) {
    const res = insertCompany.run(...company);
    companyIds.push(res.lastInsertRowid);
  }

  const insertInvoice = db.prepare(`
    INSERT INTO invoices (company_id, invoice_number, invoice_date, due_date, amount, notes, created_by)
    VALUES (?, ?, ?, ?, ?, ?, 'Prime User')
  `);

  const invoicesData = [
    [companyIds[0], 'INV-2026-101', '2026-10-01', '2026-10-31', 20000, 'Freight dispatch batch #A1'],
    [companyIds[0], 'INV-2026-102', '2026-10-08', '2026-11-08', 15000, 'Interstate logistics dues #B4'],
    [companyIds[1], 'INV-2026-103', '2026-10-02', '2026-11-02', 30000, 'Enterprise annual cloud licenses'],
    [companyIds[1], 'INV-2026-104', '2026-10-10', '2026-11-10', 20000, 'Platform security suite add-on'],
    [companyIds[2], 'INV-2026-105', '2026-10-03', '2026-11-03', 35000, 'Q3 retail inventory consignment'],
    [companyIds[2], 'INV-2026-106', '2026-10-12', '2026-11-12', 25000, 'Store fixture lines credit'],
    [companyIds[3], 'INV-2026-107', '2026-10-05', '2026-11-05', 40000, 'Digital ad placement campaign'],
    [companyIds[4], 'INV-2026-108', '2026-10-04', '2026-11-04', 45000, 'Industrial steel alloy procurement'],
    [companyIds[4], 'INV-2026-109', '2026-10-14', '2026-11-14', 30000, 'Heavy machinery tooling bill'],
    [companyIds[5], 'INV-2026-110', '2026-10-06', '2026-11-06', 25000, 'Financial risk audit retainer'],
    [companyIds[6], 'INV-2026-111', '2026-10-05', '2026-11-05', 50000, 'Bio-medical centrifuge financing'],
    [companyIds[6], 'INV-2026-112', '2026-10-15', '2026-11-15', 30000, 'Clinical trials laboratory reagents'],
    [companyIds[7], 'INV-2026-113', '2026-10-07', '2026-11-07', 30000, 'Container berth terminal charges'],
    [companyIds[8], 'INV-2026-114', '2026-10-09', '2026-11-09', 35000, 'High-grade concrete procurement'],
    [companyIds[8], 'INV-2026-115', '2026-10-16', '2026-11-16', 20000, 'Crane rental lease fees'],
    [companyIds[9], 'INV-2026-116', '2026-10-11', '2026-11-11', 45000, 'Wind turbine blades manufacturing']
  ];

  for (const inv of invoicesData) {
    insertInvoice.run(...inv);
  }

  for (const cid of companyIds) {
    syncCompanyTargetFromInvoices(cid);
  }

  const insertCollection = db.prepare(`
    INSERT INTO collections (company_id, agent_id, amount, payment_date, payment_method, reference_no, notes, recorded_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const collectionsData = [
    [companyIds[0], agentIds[0], 20000, '2026-10-12', 'Bank Transfer', 'TXN-90214', 'First installment cleared for Apex', 'Agent: Alex Mercer'],
    [companyIds[1], agentIds[0], 35000, '2026-10-18', 'Wire Transfer', 'TXN-90288', 'Enterprise tranche #1 Nexus', 'Agent: Alex Mercer'],
    [companyIds[2], agentIds[1], 45000, '2026-10-14', 'Bank Transfer', 'TXN-90230', 'Direct deposit to corporate escrow', 'Agent: Brenda Vance'],
    [companyIds[3], agentIds[1], 30000, '2026-10-20', 'Cheque', 'CHQ-88201', 'Cleared at bank for Horizon Media', 'Agent: Brenda Vance'],
    [companyIds[4], agentIds[2], 50000, '2026-10-15', 'Wire Transfer', 'TXN-90245', 'Part payment received for Quantum', 'Agent: Carlos Mendez'],
    [companyIds[5], agentIds[2], 15000, '2026-10-21', 'UPI/ACH', 'ACH-77219', 'Vendor payout transfer Vertex', 'Agent: Carlos Mendez'],
    [companyIds[6], agentIds[3], 65000, '2026-10-16', 'Bank Transfer', 'TXN-90260', 'Significant bulk payment Stellar Pharma', 'Agent: Diana Prince'],
    [companyIds[7], agentIds[3], 18000, '2026-10-22', 'Bank Transfer', 'TXN-90310', 'Port clearance collection BlueWave', 'Agent: Diana Prince'],
    [companyIds[8], agentIds[4], 32000, '2026-10-17', 'Cheque', 'CHQ-88235', 'Phase 1 construction recovery Titan', 'Agent: Evan Wright'],
    [companyIds[9], agentIds[4], 25000, '2026-10-23', 'Bank Transfer', 'TXN-90325', 'Clean energy monthly dues Aurora', 'Agent: Evan Wright']
  ];

  for (const item of collectionsData) {
    insertCollection.run(...item);
  }

  const insertReward = db.prepare(`
    INSERT INTO rewards (agent_id, amount, reward_type, reason, status, awarded_date)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const rewardsData = [
    [agentIds[3], 1500, 'Top Collector Award', 'Outstanding collection performance exceeding $80,000 threshold', 'Paid', '2026-10-23'],
    [agentIds[1], 1000, 'Milestone Bonus', 'Achieved 75% collection milestone across assigned portfolio', 'Paid', '2026-10-22'],
    [agentIds[2], 750, 'Performance Bonus', 'Fastest recovery on high-risk manufacturing account', 'Awarded', '2026-10-23'],
    [agentIds[0], 500, 'Spot Reward', 'Prompt recovery on Apex Logistics', 'Awarded', '2026-10-24'],
    [agentIds[4], 500, 'Spot Reward', 'Exemplary negotiation with Titan Construction', 'Awarded', '2026-10-24']
  ];

  for (const reward of rewardsData) {
    insertReward.run(...reward);
  }

  const insertTier = db.prepare(`
    INSERT INTO reward_tiers (tier_name, min_percentage, rate_percent, badge_name, description)
    VALUES (?, ?, ?, ?, ?)
  `);

  const tiers = [
    ['Bronze Tier', 50.0, 1.0, 'Bronze Star', '1% bonus for collecting >= 50% of assigned portfolio'],
    ['Silver Tier', 70.0, 2.0, 'Silver Shield', '2% bonus for collecting >= 70% of assigned portfolio'],
    ['Gold Tier', 85.0, 3.5, 'Gold Trophy', '3.5% bonus for collecting >= 85% of assigned portfolio'],
    ['Platinum Elite', 95.0, 5.0, 'Platinum Crown', '5% maximum bonus + trophy for achieving 95%+ recovery']
  ];

  for (const tier of tiers) {
    insertTier.run(...tier);
  }

  const companies = db.prepare('SELECT id FROM companies').all();
  for (const c of companies) {
    syncCompanyTargetFromInvoices(c.id);
  }
}

// ----------------- SQLITE QUERIES -----------------
function sqliteGetInvoices(companyId = null, agentId = null) {
  let query = `
    SELECT 
      inv.*,
      c.name as company_name,
      c.agent_id,
      a.name as agent_name,
      a.badge_color as agent_color,
      COALESCE((SELECT SUM(amount) FROM collections WHERE company_id = c.id), 0) as company_total_collected
    FROM invoices inv
    JOIN companies c ON inv.company_id = c.id
    LEFT JOIN agents a ON c.agent_id = a.id
    WHERE 1=1
  `;
  const params = [];
  if (companyId) { query += ' AND inv.company_id = ?'; params.push(companyId); }
  if (agentId) { query += ' AND c.agent_id = ?'; params.push(agentId); }
  query += ' ORDER BY inv.invoice_date DESC, inv.id DESC';
  return db.prepare(query).all(...params);
}

function sqliteCreateInvoice({ company_id, invoice_number, invoice_date, due_date, amount, notes, created_by = 'Prime User' }) {
  const compId = Number(company_id);
  const amt = Number(amount);
  const invNum = invoice_number ? invoice_number.trim() : `INV-${Date.now().toString().slice(-6)}`;
  const dateStr = invoice_date || new Date().toISOString().split('T')[0];

  const stmt = db.prepare(`
    INSERT INTO invoices (company_id, invoice_number, invoice_date, due_date, amount, notes, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const res = stmt.run(compId, invNum, dateStr, due_date || '', amt, notes || '', created_by);
  syncCompanyTargetFromInvoices(compId);
  const updatedComp = db.prepare(`SELECT c.*, a.name as agent_name FROM companies c LEFT JOIN agents a ON c.agent_id = a.id WHERE c.id = ?`).get(compId);

  return { id: res.lastInsertRowid, company_id: compId, invoice_number: invNum, invoice_date: dateStr, amount: amt, company: updatedComp };
}

function sqliteDeleteInvoice(id) {
  const inv = db.prepare('SELECT company_id FROM invoices WHERE id = ?').get(id);
  if (!inv) return false;
  db.prepare('DELETE FROM invoices WHERE id = ?').run(id);
  syncCompanyTargetFromInvoices(inv.company_id);
  return true;
}

function sqliteGetAgentDashboardData(agentId) {
  const id = Number(agentId);
  const agent = db.prepare('SELECT id, name, email, phone, badge_color, status FROM agents WHERE id = ?').get(id);
  if (!agent) return null;

  const assignedCompanies = sqliteGetCompanies(id);
  const assignedInvoices = sqliteGetInvoices(null, id);
  const collections = db.prepare(`
    SELECT col.*, comp.name as company_name
    FROM collections col
    JOIN companies comp ON col.company_id = comp.id
    WHERE col.agent_id = ?
    ORDER BY col.payment_date DESC
  `).all(id);

  const rewards = db.prepare('SELECT * FROM rewards WHERE agent_id = ? ORDER BY awarded_date DESC').all(id);

  const totalTarget = assignedCompanies.reduce((sum, c) => sum + (c.target_amount || 0), 0);
  const totalCollected = collections.reduce((sum, c) => sum + (c.amount || 0), 0);
  const pendingAmount = Math.max(0, totalTarget - totalCollected);
  const progressPercent = totalTarget > 0 ? Number(((totalCollected / totalTarget) * 100).toFixed(1)) : 0;
  const totalRewards = rewards.reduce((sum, r) => sum + (r.amount || 0), 0);

  const allShares = sqliteGetAgentShare();
  const agentRankInfo = allShares.find(a => a.id === id) || { rank: 1, percentageOfTotal: 0, suggestedTier: 'Bronze Tier' };

  return {
    agent,
    stats: {
      totalTarget,
      totalCollected,
      pendingAmount,
      progressPercent,
      assignedCompanyCount: assignedCompanies.length,
      collectionCount: collections.length,
      totalRewards,
      rank: agentRankInfo.rank,
      shareOfTotalCollections: agentRankInfo.percentageOfTotal,
      suggestedTier: agentRankInfo.suggestedTier
    },
    companies: assignedCompanies,
    invoices: assignedInvoices,
    collections,
    rewards
  };
}

function sqliteGetDashboardStats() {
  const targetRow = db.prepare('SELECT COALESCE(SUM(target_amount), 0) as total_target, COUNT(*) as total_companies FROM companies').get();
  const collectedRow = db.prepare('SELECT COALESCE(SUM(amount), 0) as total_collected, COUNT(*) as total_transactions FROM collections').get();
  const agentsCount = db.prepare("SELECT COUNT(*) as count FROM agents WHERE status = 'Active'").get().count;
  const rewardsRow = db.prepare('SELECT COALESCE(SUM(amount), 0) as total_rewards, COUNT(*) as count FROM rewards').get();
  const invoiceCount = db.prepare('SELECT COUNT(*) as count, COALESCE(SUM(amount), 0) as total_invoiced FROM invoices').get();

  const totalTarget = targetRow.total_target;
  const totalCollected = collectedRow.total_collected;
  const pendingAmount = Math.max(0, totalTarget - totalCollected);
  const progressPercent = totalTarget > 0 ? Number(((totalCollected / totalTarget) * 100).toFixed(1)) : 0;

  const topAgent = db.prepare(`
    SELECT a.id, a.name, a.badge_color, COALESCE(SUM(c.amount), 0) as total_collected
    FROM agents a
    LEFT JOIN collections c ON c.agent_id = a.id
    GROUP BY a.id
    ORDER BY total_collected DESC
    LIMIT 1
  `).get();

  return {
    totalTarget,
    totalCollected,
    pendingAmount,
    progressPercent,
    activeAgentsCount: agentsCount,
    totalCompanies: targetRow.total_companies,
    totalInvoices: invoiceCount.count,
    totalInvoicedAmount: invoiceCount.total_invoiced,
    totalTransactions: collectedRow.total_transactions,
    totalRewardsDistributed: rewardsRow.total_rewards,
    rewardCount: rewardsRow.count,
    topAgent: topAgent || null
  };
}

function sqliteGetAgentShare() {
  const totalCollectedRow = db.prepare('SELECT COALESCE(SUM(amount), 0) as total FROM collections').get();
  const grandTotal = totalCollectedRow ? totalCollectedRow.total : 0;

  const rows = db.prepare(`
    SELECT 
      a.id,
      a.name,
      a.email,
      a.phone,
      a.badge_color,
      a.status,
      COALESCE((SELECT SUM(c.target_amount) FROM companies c WHERE c.agent_id = a.id), 0) as assigned_target,
      COALESCE((SELECT COUNT(c.id) FROM companies c WHERE c.agent_id = a.id), 0) as company_count,
      COALESCE((SELECT SUM(col.amount) FROM collections col WHERE col.agent_id = a.id), 0) as total_collected,
      COALESCE((SELECT COUNT(col.id) FROM collections col WHERE col.agent_id = a.id), 0) as collection_count,
      COALESCE((SELECT SUM(r.amount) FROM rewards r WHERE r.agent_id = a.id), 0) as total_rewards
    FROM agents a
    ORDER BY total_collected DESC
  `).all();

  return rows.map((agent, index) => {
    const collected = Number(agent.total_collected || 0);
    const assignedTarget = Number(agent.assigned_target || 0);
    const percentageOfTotal = grandTotal > 0 ? Number(((collected / grandTotal) * 100).toFixed(1)) : 0;
    const targetAchievementRate = assignedTarget > 0 ? Number(((collected / assignedTarget) * 100).toFixed(1)) : 0;

    let suggestedTier = 'No Tier';
    let suggestedBonus = 0;
    if (targetAchievementRate >= 95) {
      suggestedTier = 'Platinum Elite (5%)';
      suggestedBonus = Math.round(collected * 0.05);
    } else if (targetAchievementRate >= 85) {
      suggestedTier = 'Gold Tier (3.5%)';
      suggestedBonus = Math.round(collected * 0.035);
    } else if (targetAchievementRate >= 70) {
      suggestedTier = 'Silver Tier (2%)';
      suggestedBonus = Math.round(collected * 0.02);
    } else if (targetAchievementRate >= 50) {
      suggestedTier = 'Bronze Tier (1%)';
      suggestedBonus = Math.round(collected * 0.01);
    }

    return {
      id: agent.id,
      name: agent.name,
      email: agent.email,
      phone: agent.phone,
      badgeColor: agent.badge_color,
      status: agent.status,
      assignedTarget,
      companyCount: agent.company_count,
      totalCollected: collected,
      collectionCount: agent.collection_count,
      percentageOfTotal,
      targetAchievementRate,
      totalRewards: Number(agent.total_rewards || 0),
      rank: index + 1,
      suggestedTier,
      suggestedBonus
    };
  });
}

function sqliteGetCompanies(filterAgentId = null, filterStatus = null) {
  let query = `
    SELECT 
      c.id,
      c.name,
      c.contact_person,
      c.contact_phone,
      c.category,
      c.target_amount,
      c.agent_id,
      c.status,
      c.notes,
      c.created_at,
      a.name as agent_name,
      a.badge_color as agent_color,
      COALESCE((SELECT SUM(amount) FROM collections WHERE company_id = c.id), 0) as collected_amount,
      COALESCE((SELECT COUNT(id) FROM invoices WHERE company_id = c.id), 0) as invoice_count
    FROM companies c
    LEFT JOIN agents a ON c.agent_id = a.id
    WHERE 1=1
  `;
  const params = [];
  if (filterAgentId) { query += ' AND c.agent_id = ?'; params.push(filterAgentId); }
  if (filterStatus) { query += ' AND c.status = ?'; params.push(filterStatus); }
  query += ' ORDER BY c.name ASC';

  const rows = db.prepare(query).all(...params);
  return rows.map(comp => {
    const target = Number(comp.target_amount || 0);
    const collected = Number(comp.collected_amount || 0);
    const pending = Math.max(0, target - collected);
    const progressPercent = target > 0 ? Math.min(100, Number(((collected / target) * 100).toFixed(1))) : 0;
    return {
      ...comp,
      target_amount: target,
      collected_amount: collected,
      pending_amount: pending,
      progress_percent: progressPercent
    };
  });
}

function sqliteGetCompanyById(id) {
  const comp = db.prepare(`
    SELECT 
      c.*,
      a.name as agent_name,
      a.badge_color as agent_color,
      COALESCE((SELECT SUM(amount) FROM collections WHERE company_id = c.id), 0) as collected_amount
    FROM companies c
    LEFT JOIN agents a ON c.agent_id = a.id
    WHERE c.id = ?
  `).get(id);

  if (!comp) return null;

  const invoices = db.prepare('SELECT * FROM invoices WHERE company_id = ? ORDER BY invoice_date DESC').all(id);
  const collections = db.prepare(`
    SELECT col.*, a.name as agent_name
    FROM collections col
    LEFT JOIN agents a ON col.agent_id = a.id
    WHERE col.company_id = ?
    ORDER BY col.payment_date DESC
  `).all(id);

  const target = Number(comp.target_amount || 0);
  const collected = Number(comp.collected_amount || 0);

  return {
    ...comp,
    target_amount: target,
    collected_amount: collected,
    pending_amount: Math.max(0, target - collected),
    progress_percent: target > 0 ? Number(((collected / target) * 100).toFixed(1)) : 0,
    invoices,
    collections
  };
}

function sqliteCreateCompany({ name, contact_person, contact_phone, category = 'Enterprise', target_amount = 0, agent_id = null, notes = '' }) {
  const stmt = db.prepare(`
    INSERT INTO companies (name, contact_person, contact_phone, category, target_amount, agent_id, status, notes)
    VALUES (?, ?, ?, ?, ?, ?, 'Pending', ?)
  `);
  const res = stmt.run(name, contact_person || '', contact_phone || '', category, Number(target_amount) || 0, agent_id ? Number(agent_id) : null, notes || '');
  return { id: res.lastInsertRowid, name, target_amount: Number(target_amount) };
}

function sqliteUpdateCompany(id, { name, contact_person, contact_phone, category, target_amount, agent_id, notes }) {
  const current = db.prepare('SELECT * FROM companies WHERE id = ?').get(id);
  if (!current) return null;

  const newName = name !== undefined ? name : current.name;
  const newContact = contact_person !== undefined ? contact_person : current.contact_person;
  const newPhone = contact_phone !== undefined ? contact_phone : current.contact_phone;
  const newCat = category !== undefined ? category : current.category;
  const newTarget = target_amount !== undefined ? Number(target_amount) : current.target_amount;
  const newAgent = agent_id !== undefined ? (agent_id ? Number(agent_id) : null) : current.agent_id;
  const newNotes = notes !== undefined ? notes : current.notes;

  db.prepare(`
    UPDATE companies 
    SET name = ?, contact_person = ?, contact_phone = ?, category = ?, target_amount = ?, agent_id = ?, notes = ?
    WHERE id = ?
  `).run(newName, newContact, newPhone, newCat, newTarget, newAgent, newNotes, id);
  updateCompanyStatus(id);
  return sqliteGetCompanyById(id);
}

function sqliteDeleteCompany(id) {
  const res = db.prepare('DELETE FROM companies WHERE id = ?').run(id);
  return res.changes > 0;
}

function sqliteRecordCollection({ company_id, agent_id = null, invoice_id = null, amount, payment_date, payment_method = 'Bank Transfer', reference_no = '', notes = '', recorded_by }) {
  let assignedAgentId = agent_id;
  if (!assignedAgentId) {
    const comp = db.prepare('SELECT agent_id FROM companies WHERE id = ?').get(company_id);
    if (comp) assignedAgentId = comp.agent_id;
  }

  let recorder = recorded_by;
  if (!recorder) {
    if (assignedAgentId) {
      const a = db.prepare('SELECT name FROM agents WHERE id = ?').get(assignedAgentId);
      recorder = a ? `Agent: ${a.name}` : 'Agent';
    } else {
      recorder = 'Prime User';
    }
  }

  const stmt = db.prepare(`
    INSERT INTO collections (company_id, agent_id, invoice_id, amount, payment_date, payment_method, reference_no, notes, recorded_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const formattedDate = payment_date || new Date().toISOString().split('T')[0];
  const refNo = reference_no || `COL-${Date.now().toString().slice(-6)}`;

  const res = stmt.run(Number(company_id), assignedAgentId ? Number(assignedAgentId) : null, invoice_id ? Number(invoice_id) : null, Number(amount), formattedDate, payment_method, refNo, notes, recorder);
  updateCompanyStatus(Number(company_id));

  return { id: res.lastInsertRowid, company_id: Number(company_id), agent_id: assignedAgentId ? Number(assignedAgentId) : null, amount: Number(amount), payment_date: formattedDate, reference_no: refNo, recorded_by: recorder };
}

function sqliteDeleteCollection(id) {
  const col = db.prepare('SELECT company_id FROM collections WHERE id = ?').get(id);
  if (!col) return false;
  db.prepare('DELETE FROM collections WHERE id = ?').run(id);
  updateCompanyStatus(col.company_id);
  return true;
}

function sqliteGetCollections(limit = 100, agentId = null) {
  let query = `
    SELECT 
      col.*,
      comp.name as company_name,
      comp.target_amount as company_target,
      a.name as agent_name,
      a.badge_color as agent_color
    FROM collections col
    JOIN companies comp ON col.company_id = comp.id
    LEFT JOIN agents a ON col.agent_id = a.id
    WHERE 1=1
  `;
  const params = [];
  if (agentId) { query += ' AND col.agent_id = ?'; params.push(agentId); }
  query += ' ORDER BY col.payment_date DESC, col.id DESC LIMIT ?';
  params.push(limit);
  return db.prepare(query).all(...params);
}

function sqliteGrantReward({ agent_id, amount, reward_type = 'Performance Bonus', reason = '', status = 'Awarded', awarded_date }) {
  const dateStr = awarded_date || new Date().toISOString().split('T')[0];
  const stmt = db.prepare(`INSERT INTO rewards (agent_id, amount, reward_type, reason, status, awarded_date) VALUES (?, ?, ?, ?, ?, ?)`);
  const res = stmt.run(Number(agent_id), Number(amount), reward_type, reason, status, dateStr);
  return { id: res.lastInsertRowid, agent_id: Number(agent_id), amount: Number(amount), reward_type, reason, status, awarded_date: dateStr };
}

function sqliteUpdateReward(id, { status, amount, reason }) {
  const current = db.prepare('SELECT * FROM rewards WHERE id = ?').get(id);
  if (!current) return null;
  const newStatus = status || current.status;
  const newAmount = amount !== undefined ? Number(amount) : current.amount;
  const newReason = reason !== undefined ? reason : current.reason;
  db.prepare('UPDATE rewards SET status = ?, amount = ?, reason = ? WHERE id = ?').run(newStatus, newAmount, newReason, id);
  return { id, status: newStatus, amount: newAmount, reason: newReason };
}

function sqliteDeleteReward(id) {
  const res = db.prepare('DELETE FROM rewards WHERE id = ?').run(id);
  return res.changes > 0;
}

function sqliteGetRewards(agentId = null) {
  let query = `
    SELECT r.*, a.name as agent_name, a.badge_color as agent_color, a.email as agent_email
    FROM rewards r
    JOIN agents a ON r.agent_id = a.id
    WHERE 1=1
  `;
  const params = [];
  if (agentId) { query += ' AND r.agent_id = ?'; params.push(agentId); }
  query += ' ORDER BY r.awarded_date DESC, r.id DESC';
  return db.prepare(query).all(...params);
}

function sqliteGetRewardTiers() {
  return db.prepare('SELECT * FROM reward_tiers ORDER BY min_percentage ASC').all();
}

function sqliteAuthenticateUser(role, identifier, password) {
  if (role === 'prime') {
    if ((identifier === 'prime' || identifier === 'admin@nexus.com' || identifier === 'prime@nexus.com') && (password === 'admin123' || password === 'prime123' || !password)) {
      return { role: 'prime', name: 'Prime User (Master Admin)', email: 'prime@nexus.com', avatar: '👑' };
    }
    if (identifier === 'prime' || !identifier) {
      return { role: 'prime', name: 'Prime User (Master Admin)', email: 'prime@nexus.com', avatar: '👑' };
    }
    return null;
  }

  if (role === 'agent') {
    let agent;
    if (!isNaN(Number(identifier))) {
      agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(Number(identifier));
    } else {
      agent = db.prepare('SELECT * FROM agents WHERE email = ? OR name LIKE ?').get(identifier, `%${identifier}%`);
    }

    if (!agent) return null;
    if (password && password !== agent.password && password !== 'agent123') return null;

    return {
      role: 'agent',
      id: agent.id,
      name: agent.name,
      email: agent.email,
      phone: agent.phone,
      badgeColor: agent.badge_color,
      status: agent.status
    };
  }
  return null;
}

function sqliteCreateAgent({ name, email, phone, badge_color = '#3b82f6', status = 'Active', password = 'agent123' }) {
  const stmt = db.prepare(`INSERT INTO agents (name, email, phone, password, badge_color, status) VALUES (?, ?, ?, ?, ?, ?)`);
  const safeEmail = email && email.trim() ? email.trim() : `${name.toLowerCase().replace(/[^a-z0-9]/g, '')}@collections.com`;
  const res = stmt.run(name, safeEmail, phone || '', password || 'agent123', badge_color, status);
  return { id: res.lastInsertRowid, name, email: safeEmail, phone, badge_color, status };
}

function sqliteUpdateAgent(id, { name, email, phone, badge_color, status, password }) {
  const current = db.prepare('SELECT * FROM agents WHERE id = ?').get(id);
  if (!current) return null;
  const newName = name !== undefined ? name : current.name;
  const newEmail = email !== undefined ? email : current.email;
  const newPhone = phone !== undefined ? phone : current.phone;
  const newColor = badge_color !== undefined ? badge_color : current.badge_color;
  const newStatus = status !== undefined ? status : current.status;
  const newPassword = password !== undefined ? password : current.password;
  db.prepare(`UPDATE agents SET name = ?, email = ?, phone = ?, badge_color = ?, status = ?, password = ? WHERE id = ?`).run(newName, newEmail, newPhone, newColor, newStatus, newPassword, id);
  return { id, name: newName, email: newEmail, phone: newPhone, badge_color: newColor, status: newStatus };
}

function sqliteDeleteAgent(id) {
  db.prepare('UPDATE companies SET agent_id = NULL WHERE agent_id = ?').run(id);
  db.prepare('DELETE FROM rewards WHERE agent_id = ?').run(id);
  db.prepare('UPDATE collections SET agent_id = NULL WHERE agent_id = ?').run(id);
  const res = db.prepare('DELETE FROM agents WHERE id = ?').run(id);
  return res.changes > 0;
}

// ----------------- SMART ROUTER / HYBRID EXPORTS -----------------
initDatabase();

const isSupabase = supabase.isConfigured();
if (isSupabase) {
  console.log(`[Database] Connected to Supabase Cloud PostgreSQL: ${process.env.SUPABASE_URL}`);
} else {
  console.log(`[Database] Running in Local SQLite Mode (To switch to Supabase, provide SUPABASE_URL in .env)`);
}

module.exports = {
  db,
  isSupabaseConfigured: () => supabase.isConfigured(),
  getDashboardStats: async () => supabase.isConfigured() ? await supabase.getDashboardStats() : sqliteGetDashboardStats(),
  getAgentShare: async () => supabase.isConfigured() ? await supabase.getAgentShare() : sqliteGetAgentShare(),
  getAgents: async () => supabase.isConfigured() ? await supabase.getAgents() : sqliteGetAgentShare(),
  getAgentById: async (id) => supabase.isConfigured() ? await supabase.getAgentById(id) : sqliteGetAgentDashboardData(id),
  createAgent: async (d) => supabase.isConfigured() ? await supabase.createAgent(d) : sqliteCreateAgent(d),
  updateAgent: async (id, d) => supabase.isConfigured() ? await supabase.updateAgent(id, d) : sqliteUpdateAgent(id, d),
  deleteAgent: async (id) => supabase.isConfigured() ? await supabase.deleteAgent(id) : sqliteDeleteAgent(id),
  getCompanies: async (aId, st) => supabase.isConfigured() ? await supabase.getCompanies(aId, st) : sqliteGetCompanies(aId, st),
  getCompanyById: async (id) => supabase.isConfigured() ? await supabase.getCompanyById(id) : sqliteGetCompanyById(id),
  createCompany: async (d) => supabase.isConfigured() ? await supabase.createCompany(d) : sqliteCreateCompany(d),
  updateCompany: async (id, d) => supabase.isConfigured() ? await supabase.updateCompany(id, d) : sqliteUpdateCompany(id, d),
  deleteCompany: async (id) => supabase.isConfigured() ? await supabase.deleteCompany(id) : sqliteDeleteCompany(id),
  getInvoices: async (cId, aId) => supabase.isConfigured() ? await supabase.getInvoices(cId, aId) : sqliteGetInvoices(cId, aId),
  createInvoice: async (d) => supabase.isConfigured() ? await supabase.createInvoice(d) : sqliteCreateInvoice(d),
  deleteInvoice: async (id) => supabase.isConfigured() ? await supabase.deleteInvoice(id) : sqliteDeleteInvoice(id),
  recordCollection: async (d) => supabase.isConfigured() ? await supabase.recordCollection(d) : sqliteRecordCollection(d),
  deleteCollection: async (id) => supabase.isConfigured() ? await supabase.deleteCollection(id) : sqliteDeleteCollection(id),
  getCollections: async (l, aId) => supabase.isConfigured() ? await supabase.getCollections(l, aId) : sqliteGetCollections(l, aId),
  grantReward: async (d) => supabase.isConfigured() ? await supabase.grantReward(d) : sqliteGrantReward(d),
  updateReward: async (id, d) => supabase.isConfigured() ? await supabase.updateReward(id, d) : sqliteUpdateReward(id, d),
  deleteReward: async (id) => supabase.isConfigured() ? await supabase.deleteReward(id) : sqliteDeleteReward(id),
  getRewards: async (aId) => supabase.isConfigured() ? await supabase.getRewards(aId) : sqliteGetRewards(aId),
  getRewardTiers: async () => supabase.isConfigured() ? await supabase.getRewardTiers() : sqliteGetRewardTiers(),
  getAgentDashboardData: async (id) => supabase.isConfigured() ? await supabase.getAgentDashboardData(id) : sqliteGetAgentDashboardData(id),
  authenticateUser: async (r, i, p) => supabase.isConfigured() ? await supabase.authenticateUser(r, i, p) : sqliteAuthenticateUser(r, i, p),
  seedInitialData: () => seedInitialData()
};

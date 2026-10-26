// server.js - HTTP API Server & Static Asset Server with Prime User & Agent Roles + Invoices
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const url = require('node:url');

// Auto-load .env file if available
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath) && typeof process.loadEnvFile === 'function') {
  try {
    process.loadEnvFile(envPath);
  } catch (e) {}
}

const db = require('./db.js');

let PORT = parseInt(process.env.PORT || '3050', 10);
const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

function sendJSON(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  });
  res.end(JSON.stringify(data));
}

function parseJSONBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 1e6) { // 1MB limit
        req.destroy();
        reject(new Error('Request entity too large'));
      }
    });
    req.on('end', () => {
      try {
        const parsed = body ? JSON.parse(body) : {};
        resolve(parsed);
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function serveStatic(req, res, pathname) {
  let safePath = pathname === '/' ? '/index.html' : pathname;
  const resolvedPath = path.normalize(path.join(PUBLIC_DIR, safePath));
  if (!resolvedPath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('Access Forbidden');
    return;
  }

  fs.stat(resolvedPath, (err, stats) => {
    if (err || !stats.isFile()) {
      if (!pathname.startsWith('/api')) {
        const indexPath = path.join(PUBLIC_DIR, 'index.html');
        fs.readFile(indexPath, (readErr, content) => {
          if (readErr) {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('Not Found');
          } else {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(content);
          }
        });
        return;
      }
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Endpoint not found' }));
      return;
    }

    const ext = path.extname(resolvedPath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    fs.readFile(resolvedPath, (readErr, content) => {
      if (readErr) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Internal Server Error');
      } else {
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(content);
      }
    });
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    });
    res.end();
    return;
  }

  const parsedUrl = url.parse(req.url, true);
  const { pathname, query } = parsedUrl;

  try {
    if (pathname.startsWith('/api/')) {
      // System DB Status
      if (pathname === '/api/system/status' && req.method === 'GET') {
        const isSupabase = db.isSupabaseConfigured();
        return sendJSON(res, 200, {
          database: isSupabase ? 'Supabase Cloud PostgreSQL' : 'Local SQLite',
          supabaseConnected: isSupabase
        });
      }

      // ----------------- AUTHENTICATION -----------------
      if (pathname === '/api/auth/login' && req.method === 'POST') {
        const body = await parseJSONBody(req);
        const { role, identifier, password } = body;
        const user = await db.authenticateUser(role, identifier, password);
        if (!user) {
          return sendJSON(res, 401, { error: 'Invalid login credentials' });
        }
        return sendJSON(res, 200, { success: true, user });
      }

      if (pathname === '/api/auth/agents-list' && req.method === 'GET') {
        const rawAgents = await db.getAgents();
        const agents = rawAgents.map(a => ({
          id: a.id,
          name: a.name,
          email: a.email,
          badgeColor: a.badgeColor
        }));
        return sendJSON(res, 200, agents);
      }

      // ----------------- AGENT PORTAL SPECIFIC DASHBOARD -----------------
      const agentDashboardMatch = pathname.match(/^\/api\/agent-dashboard\/(\d+)$/);
      if (agentDashboardMatch && req.method === 'GET') {
        const agentId = Number(agentDashboardMatch[1]);
        const agentData = await db.getAgentDashboardData(agentId);
        if (!agentData) return sendJSON(res, 404, { error: 'Agent not found' });
        return sendJSON(res, 200, agentData);
      }

      // ----------------- PRIME USER INVOICE / BILLS MANAGEMENT -----------------
      if (pathname === '/api/invoices') {
        if (req.method === 'GET') {
          const companyId = query.company_id ? Number(query.company_id) : null;
          const agentId = query.agent_id ? Number(query.agent_id) : null;
          const invoices = await db.getInvoices(companyId, agentId);
          return sendJSON(res, 200, invoices);
        }
        if (req.method === 'POST') {
          const body = await parseJSONBody(req);
          if (!body.company_id) {
            return sendJSON(res, 400, { error: 'Company ID is required' });
          }
          if (!body.amount || isNaN(Number(body.amount)) || Number(body.amount) <= 0) {
            return sendJSON(res, 400, { error: 'Valid invoice amount is required' });
          }
          if (!body.invoice_number || !body.invoice_number.trim()) {
            return sendJSON(res, 400, { error: 'Invoice number is required' });
          }
          try {
            const created = await db.createInvoice(body);
            return sendJSON(res, 201, created);
          } catch (e) {
            if (e.message && e.message.includes('UNIQUE constraint failed')) {
              return sendJSON(res, 400, { error: `Invoice number "${body.invoice_number}" already exists` });
            }
            throw e;
          }
        }
      }

      const invoiceIdMatch = pathname.match(/^\/api\/invoices\/(\d+)$/);
      if (invoiceIdMatch && req.method === 'DELETE') {
        const invId = Number(invoiceIdMatch[1]);
        const deleted = await db.deleteInvoice(invId);
        if (!deleted) return sendJSON(res, 404, { error: 'Invoice not found' });
        return sendJSON(res, 200, { success: true, message: 'Invoice deleted and company bill updated' });
      }

      // ----------------- DASHBOARD STATS -----------------
      if (pathname === '/api/dashboard/stats' && req.method === 'GET') {
        const stats = await db.getDashboardStats();
        return sendJSON(res, 200, stats);
      }

      // ----------------- AGENT SHARE (PIE CHART) -----------------
      if (pathname === '/api/dashboard/agent-share' && req.method === 'GET') {
        const share = await db.getAgentShare();
        return sendJSON(res, 200, share);
      }

      // ----------------- AGENTS CRUD -----------------
      if (pathname === '/api/agents') {
        if (req.method === 'GET') {
          const agents = await db.getAgents();
          return sendJSON(res, 200, agents);
        }
        if (req.method === 'POST') {
          const body = await parseJSONBody(req);
          if (!body.name || !body.name.trim()) {
            return sendJSON(res, 400, { error: 'Agent name is required' });
          }
          const created = await db.createAgent(body);
          return sendJSON(res, 201, created);
        }
      }

      const agentIdMatch = pathname.match(/^\/api\/agents\/(\d+)$/);
      if (agentIdMatch) {
        const agentId = Number(agentIdMatch[1]);
        if (req.method === 'GET') {
          const agent = await db.getAgentById(agentId);
          if (!agent) return sendJSON(res, 404, { error: 'Agent not found' });
          return sendJSON(res, 200, agent);
        }
        if (req.method === 'PUT') {
          const body = await parseJSONBody(req);
          const updated = await db.updateAgent(agentId, body);
          if (!updated) return sendJSON(res, 404, { error: 'Agent not found' });
          return sendJSON(res, 200, updated);
        }
        if (req.method === 'DELETE') {
          const deleted = await db.deleteAgent(agentId);
          if (!deleted) return sendJSON(res, 404, { error: 'Agent not found' });
          return sendJSON(res, 200, { success: true, message: 'Agent deleted' });
        }
      }

      // ----------------- COMPANIES CRUD -----------------
      if (pathname === '/api/companies') {
        if (req.method === 'GET') {
          const agentId = query.agent_id ? Number(query.agent_id) : null;
          const status = query.status || null;
          const companies = await db.getCompanies(agentId, status);
          return sendJSON(res, 200, companies);
        }
        if (req.method === 'POST') {
          const body = await parseJSONBody(req);
          if (!body.name || !body.name.trim()) {
            return sendJSON(res, 400, { error: 'Company name is required' });
          }
          const created = await db.createCompany(body);
          return sendJSON(res, 201, created);
        }
      }

      const companyIdMatch = pathname.match(/^\/api\/companies\/(\d+)$/);
      if (companyIdMatch) {
        const companyId = Number(companyIdMatch[1]);
        if (req.method === 'GET') {
          const company = await db.getCompanyById(companyId);
          if (!company) return sendJSON(res, 404, { error: 'Company not found' });
          return sendJSON(res, 200, company);
        }
        if (req.method === 'PUT') {
          const body = await parseJSONBody(req);
          const updated = await db.updateCompany(companyId, body);
          if (!updated) return sendJSON(res, 404, { error: 'Company not found' });
          return sendJSON(res, 200, updated);
        }
        if (req.method === 'DELETE') {
          const deleted = await db.deleteCompany(companyId);
          if (!deleted) return sendJSON(res, 404, { error: 'Company not found' });
          return sendJSON(res, 200, { success: true, message: 'Company deleted' });
        }
      }

      // ----------------- COLLECTIONS (AGENT OR PRIME USER ENTERS MONEY) -----------------
      if (pathname === '/api/collections') {
        if (req.method === 'GET') {
          const limit = query.limit ? Number(query.limit) : 100;
          const agentId = query.agent_id ? Number(query.agent_id) : null;
          const collections = await db.getCollections(limit, agentId);
          return sendJSON(res, 200, collections);
        }
        if (req.method === 'POST') {
          const body = await parseJSONBody(req);
          if (!body.company_id) {
            return sendJSON(res, 400, { error: 'Company ID is required' });
          }
          if (!body.amount || isNaN(Number(body.amount)) || Number(body.amount) <= 0) {
            return sendJSON(res, 400, { error: 'Valid positive collection amount is required' });
          }
          const recorded = await db.recordCollection(body);
          return sendJSON(res, 201, recorded);
        }
      }

      const collectionIdMatch = pathname.match(/^\/api\/collections\/(\d+)$/);
      if (collectionIdMatch && req.method === 'DELETE') {
        const colId = Number(collectionIdMatch[1]);
        const deleted = await db.deleteCollection(colId);
        if (!deleted) return sendJSON(res, 404, { error: 'Collection not found' });
        return sendJSON(res, 200, { success: true, message: 'Collection deleted' });
      }

      // ----------------- REWARDS -----------------
      if (pathname === '/api/rewards') {
        if (req.method === 'GET') {
          const agentId = query.agent_id ? Number(query.agent_id) : null;
          const rewards = await db.getRewards(agentId);
          return sendJSON(res, 200, rewards);
        }
        if (req.method === 'POST') {
          const body = await parseJSONBody(req);
          if (!body.agent_id) {
            return sendJSON(res, 400, { error: 'Agent ID is required' });
          }
          if (!body.amount || isNaN(Number(body.amount)) || Number(body.amount) <= 0) {
            return sendJSON(res, 400, { error: 'Valid positive reward amount is required' });
          }
          const reward = await db.grantReward(body);
          return sendJSON(res, 201, reward);
        }
      }

      const rewardIdMatch = pathname.match(/^\/api\/rewards\/(\d+)$/);
      if (rewardIdMatch) {
        const rewardId = Number(rewardIdMatch[1]);
        if (req.method === 'PUT') {
          const body = await parseJSONBody(req);
          const updated = await db.updateReward(rewardId, body);
          if (!updated) return sendJSON(res, 404, { error: 'Reward not found' });
          return sendJSON(res, 200, updated);
        }
        if (req.method === 'DELETE') {
          const deleted = await db.deleteReward(rewardId);
          if (!deleted) return sendJSON(res, 404, { error: 'Reward not found' });
          return sendJSON(res, 200, { success: true, message: 'Reward deleted' });
        }
      }

      if (pathname === '/api/reward-tiers' && req.method === 'GET') {
        const tiers = await db.getRewardTiers();
        return sendJSON(res, 200, tiers);
      }

      // ----------------- RESET DEMO DATA -----------------
      if (pathname === '/api/reset-demo' && req.method === 'POST') {
        db.seedInitialData();
        return sendJSON(res, 200, { success: true, message: 'Demo data reset successfully' });
      }

      // ----------------- EXPORT CSV -----------------
      if (pathname === '/api/export/csv' && req.method === 'GET') {
        const collections = await db.getCollections(500);
        let csv = 'ID,Company,Agent,Amount,Date,Payment Method,Reference No,Recorded By,Notes\n';
        for (const c of collections) {
          const row = [
            c.id,
            `"${(c.company_name || '').replace(/"/g, '""')}"`,
            `"${(c.agent_name || 'Unassigned').replace(/"/g, '""')}"`,
            c.amount,
            c.payment_date,
            `"${(c.payment_method || '').replace(/"/g, '""')}"`,
            `"${(c.reference_no || '').replace(/"/g, '""')}"`,
            `"${(c.recorded_by || '').replace(/"/g, '""')}"`,
            `"${(c.notes || '').replace(/"/g, '""')}"`
          ].join(',');
          csv += row + '\n';
        }
        res.writeHead(200, {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': 'attachment; filename="collections_report.csv"'
        });
        res.end(csv);
        return;
      }

      return sendJSON(res, 404, { error: `Endpoint not found: ${req.method} ${pathname}` });
    }

    // Serve static files
    serveStatic(req, res, pathname);
  } catch (error) {
    console.error('Server error:', error);
    sendJSON(res, 500, { error: 'Internal server error', details: error.message });
  }
});

function startServer(portToTry) {
  server.once('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.warn(`Port ${portToTry} is in use, trying ${portToTry + 1}...`);
      try {
        server.close(() => startServer(portToTry + 1));
      } catch {
        startServer(portToTry + 1);
      }
    } else {
      console.error('Server error:', err);
    }
  });

  server.listen(portToTry, '0.0.0.0', () => {
    PORT = portToTry;
    console.log(`Corporate Collection System server running on:`);
    console.log(`  - Local:   http://localhost:${PORT}`);
    console.log(`  - Network: http://127.0.0.1:${PORT}`);
    console.log(`Prime User Portal is ready.`);
  });
}

if (require.main === module) {
  startServer(PORT);
}

module.exports = { server, startServer };

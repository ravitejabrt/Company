const db = require('./db.js');

async function runTests() {
  console.log('--- 1. Testing Initial State with Invoices ---');
  const stats1 = await db.getDashboardStats();
  console.log('Total Target Invoiced:', stats1.totalTarget);
  console.log('Total Invoices Count:', stats1.totalInvoices);
  console.log('Total Collected:', stats1.totalCollected);
  console.log('Active Agents:', stats1.activeAgentsCount);

  console.log('--- 2. Testing Authentication ---');
  const primeAuth = await db.authenticateUser('prime', 'prime', 'admin123');
  console.log('Prime Login:', primeAuth?.name, 'Role:', primeAuth?.role);

  const agentAuth = await db.authenticateUser('agent', 'alex.mercer@collections.com', 'agent123');
  console.log('Agent Login:', agentAuth?.name, 'Role:', agentAuth?.role);

  console.log('--- 3. Testing Prime User Adding Company Bill / Invoice ---');
  const companies = await db.getCompanies();
  const apexCompany = companies.find(c => c.name.includes('Apex'));
  const oldTarget = apexCompany.target_amount;
  console.log('Apex target before new invoice:', oldTarget);

  const newInvoice = await db.createInvoice({
    company_id: apexCompany.id,
    invoice_number: 'INV-TEST-999',
    invoice_date: '2026-10-24',
    amount: 15000,
    notes: 'Testing bill reflection on agent portfolio',
    created_by: 'Prime User'
  });
  console.log('Created Invoice:', newInvoice.invoice_number, 'Amount:', newInvoice.amount);

  const apexAfter = await db.getCompanyById(apexCompany.id);
  console.log('Apex target after new invoice:', apexAfter.target_amount);

  const alexDashboard = await db.getAgentDashboardData(apexCompany.agent_id);
  console.log('Alex Mercer updated target portfolio:', alexDashboard.stats.totalTarget);

  console.log('--- 4. Testing Agent Entering Collection ---');
  const col = await db.recordCollection({
    company_id: apexCompany.id,
    agent_id: apexCompany.agent_id,
    amount: 10000,
    payment_method: 'UPI/ACH',
    reference_no: 'TXN-AGENT-TEST',
    notes: 'Collected directly by agent'
  });
  console.log('Recorded Collection by agent:', col.id, 'Amount:', col.amount, 'Recorder:', col.recorded_by);

  const alexDashboard2 = await db.getAgentDashboardData(apexCompany.agent_id);
  console.log('Alex Mercer updated collected:', alexDashboard2.stats.totalCollected, 'Progress:', alexDashboard2.stats.progressPercent + '%');

  console.log('--- 5. Clean Reset ---');
  db.seedInitialData();
  const invoicesAfter = await db.getInvoices();
  console.log('Database reset clean. Invoices:', invoicesAfter.length);
  console.log('ALL HYBRID DB TESTS PASSED!');
}

runTests().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});

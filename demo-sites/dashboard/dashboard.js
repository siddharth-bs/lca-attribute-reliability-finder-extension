/**
 * MetricsHQ Dashboard — SPA
 * Tests: SPA navigation, stable form attrs, dynamic class/render-id
 */
function rHex(n){return Array.from({length:n},()=>Math.floor(Math.random()*16).toString(16)).join('');}
function dynClass(b){return `css-${rHex(6)} ${b}`;}
function dynId(b){return `${b}-${rHex(5)}`;}
function dynTid(b){return `${b}-${rHex(4)}`;}
function rand(min,max){return Math.floor(Math.random()*(max-min+1))+min;}
function fmt(n){return n>=1000?(n/1000).toFixed(1)+'k':n.toString();}

function showToast(msg){
  const c=document.getElementById('toast-container');if(!c)return;
  const t=document.createElement('div');t.className='toast';t.textContent=msg;
  c.appendChild(t);setTimeout(()=>t.remove(),3000);
}

const MONTHS=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const COLORS=['#63b3ed','#48bb78','#b794f4','#f6ad55','#fc8181','#ecc94b'];

function getRoute(){
  const h=location.hash||'#/overview';
  if(h==='#/analytics')return'analytics';
  if(h==='#/reports')return'reports';
  if(h==='#/settings')return'settings';
  return'overview';
}

window.addEventListener('hashchange',render);
window.addEventListener('load',render);

function updateNav(){
  const r=getRoute();
  document.querySelectorAll('.nav-link').forEach(a=>{
    a.classList.remove('active');
    const h=a.getAttribute('href');
    if(r==='overview'&&h==='#/overview')a.classList.add('active');
    if(r==='analytics'&&h==='#/analytics')a.classList.add('active');
    if(r==='reports'&&h==='#/reports')a.classList.add('active');
    if(r==='settings'&&h==='#/settings')a.classList.add('active');
  });
  const nav=document.getElementById('main-nav');
  if(nav)nav.setAttribute('data-render-id',`rd-${rHex(8)}`);
}

function render(){
  updateNav();
  const root=document.getElementById('dash-root');if(!root)return;
  const r=getRoute();
  const pages={overview:renderOverview,analytics:renderAnalytics,reports:renderReports,settings:renderSettings};
  root.innerHTML=(pages[r]||renderOverview)();
  attachEvents();
}

function kpiCard(id,label,value,change,up){
  return`<div class="kpi-card ${dynClass('')}" id="${dynId('kpi-'+id)}" data-testid="kpi-${id}" aria-label="${label} metric card" role="region">
    <div class="kpi-label">${label}</div>
    <div class="kpi-value" id="kpi-val-${id}" data-testid="kpi-val-${id}">${value}</div>
    <div class="kpi-change ${up?'kpi-up':'kpi-down'}">${up?'↑':'↓'} ${change} vs last period</div>
  </div>`;
}

function barChart(id,label,data){
  const max=Math.max(...data.map(d=>d.v));
  const bars=data.map((d,i)=>`
    <div class="chart-bar-wrap">
      <div class="chart-bar" style="height:${Math.round((d.v/max)*120)}px;background:${COLORS[i%COLORS.length]}" title="${d.l}: ${d.v}"></div>
      <div class="chart-bar-label">${d.l}</div>
    </div>`).join('');
  return`<div class="chart-area" id="${dynId('chart-'+id)}" data-testid="chart-${id}" aria-label="${label} chart" role="img">
    <div class="chart-header"><h3>${label}</h3><span style="font-size:12px;color:var(--muted)">${data.length} data points</span></div>
    <div class="chart-bars">${bars}</div>
  </div>`;
}

function renderOverview(){
  const months=MONTHS.slice(0,8).map(m=>({l:m,v:rand(1200,8000)}));
  const cats=['Electronics','Footwear','Kitchen','Fitness','Home'].map(c=>({l:c,v:rand(500,4000)}));
  return`<div class="container page-content">
    <div class="kpi-grid">
      ${kpiCard('revenue','Total Revenue','$'+fmt(rand(45000,95000)),rand(5,25)+'%',true)}
      ${kpiCard('orders','Orders',fmt(rand(1200,3400)),rand(3,18)+'%',true)}
      ${kpiCard('customers','New Customers',fmt(rand(340,890)),rand(2,12)+'%',true)}
      ${kpiCard('aov','Avg Order Value','$'+rand(45,120),rand(1,8)+'%',Math.random()>0.4)}
    </div>
    <div class="sidebar-layout">
      <div>
        ${barChart('monthly','Monthly Revenue',months)}
        ${barChart('category','Revenue by Category',cats)}
      </div>
      <div>
        <div class="activity-feed" id="activity-feed" data-testid="activity-feed" aria-label="Recent activity feed">
          <h3 style="margin-bottom:12px">Recent Activity</h3>
          ${[
            {icon:'🛒',text:'New order #4521 from Jane D.',time:'2 min ago'},
            {icon:'👤',text:'New customer registered: john@example.com',time:'8 min ago'},
            {icon:'📦',text:'Order #4518 shipped via FedEx',time:'15 min ago'},
            {icon:'💳',text:'Payment received $234.50',time:'22 min ago'},
            {icon:'⭐',text:'New 5-star review on Headphones Pro',time:'1h ago'},
            {icon:'🔄',text:'Return request #R-0234 approved',time:'2h ago'},
          ].map(a=>`<div class="activity-item"><div class="activity-icon">${a.icon}</div><div><div class="activity-text">${a.text}</div><div class="activity-time">${a.time}</div></div></div>`).join('')}
        </div>
      </div>
    </div>
    <div class="table-card" id="recent-orders-table" data-testid="recent-orders-table" aria-label="Recent orders table">
      <div class="table-header"><h3>Recent Orders</h3><button id="view-all-orders-btn" name="viewAllOrders" type="button" data-testid="view-all-orders-btn" class="${dynClass('btn btn-secondary btn-sm')}" aria-label="View all orders" role="button">View All</button></div>
      <table role="table" aria-label="Orders list">
        <thead><tr><th>Order ID</th><th>Customer</th><th>Product</th><th>Amount</th><th>Status</th></tr></thead>
        <tbody>
          ${[
            {id:'#4521',cust:'Jane Doe',prod:'Headphones Pro',amt:'$149.99',status:'active'},
            {id:'#4520',cust:'Bob Smith',prod:'Yoga Mat',amt:'$59.99',status:'active'},
            {id:'#4519',cust:'Alice Chen',prod:'Keyboard TKL',amt:'$189.99',status:'pending'},
            {id:'#4518',cust:'Mike Johnson',prod:'Running Shoes',amt:'$129.99',status:'active'},
            {id:'#4517',cust:'Sara Lee',prod:'Coffee Maker',amt:'$89.99',status:'inactive'},
          ].map(o=>`<tr><td><strong>${o.id}</strong></td><td>${o.cust}</td><td>${o.prod}</td><td style="color:var(--green)">${o.amt}</td><td><span class="status-dot status-${o.status}"></span>${o.status.charAt(0).toUpperCase()+o.status.slice(1)}</td></tr>`).join('')}
        </tbody>
      </table>
    </div>
  </div>`;
}

function renderAnalytics(){
  const weeks=Array.from({length:12},(_,i)=>({l:`W${i+1}`,v:rand(800,5000)}));
  const channels=['Organic','Paid','Email','Social','Direct'].map(c=>({l:c,v:rand(200,2000)}));
  return`<div class="container page-content">
    <h2 style="margin-bottom:24px">Analytics</h2>
    <div class="kpi-grid">
      ${kpiCard('sessions','Sessions',fmt(rand(12000,45000)),rand(5,20)+'%',true)}
      ${kpiCard('bounce','Bounce Rate',rand(25,55)+'%',rand(1,8)+'%',false)}
      ${kpiCard('conv','Conversion Rate',rand(2,8).toFixed(1)+'%',rand(0,3).toFixed(1)+'%',true)}
      ${kpiCard('ltv','Avg LTV','$'+rand(180,450),rand(5,15)+'%',true)}
    </div>
    ${barChart('weekly','Weekly Sessions',weeks)}
    ${barChart('channels','Traffic by Channel',channels)}
    <div class="table-card" id="top-pages-table" data-testid="top-pages-table" aria-label="Top pages table">
      <div class="table-header"><h3>Top Pages</h3></div>
      <table><thead><tr><th>Page</th><th>Views</th><th>Avg Time</th><th>Bounce</th></tr></thead>
      <tbody>
        ${['/products','/home','/checkout','/product/p1','/account'].map(p=>`
        <tr><td><code>${p}</code></td><td>${fmt(rand(500,8000))}</td><td>${rand(1,5)}m ${rand(0,59)}s</td><td>${rand(20,60)}%</td></tr>`).join('')}
      </tbody></table>
    </div>
  </div>`;
}

function renderReports(){
  return`<div class="container page-content">
    <h2 style="margin-bottom:24px">Reports</h2>
    <div class="grid-2">
      ${['Sales Report','Customer Report','Inventory Report','Marketing Report'].map((r,i)=>`
      <div class="card" id="${dynId('report-card-'+i)}" data-testid="report-card-${i}" aria-label="${r} card">
        <div class="card-body">
          <h3 style="margin-bottom:8px">${['📈','👥','📦','📣'][i]} ${r}</h3>
          <p style="margin-bottom:16px">Last generated: ${rand(1,30)} days ago</p>
          <div style="display:flex;gap:8px">
            <button id="${dynId('gen-report-'+i)}" data-testid="generate-report-${i}" name="generateReport" type="button" class="${dynClass('btn btn-primary btn-sm')}" aria-label="Generate ${r}" role="button">Generate</button>
            <button id="${dynId('dl-report-'+i)}" data-testid="download-report-${i}" name="downloadReport" type="button" class="${dynClass('btn btn-secondary btn-sm')}" aria-label="Download ${r}" role="button">Download</button>
          </div>
        </div>
      </div>`).join('')}
    </div>
  </div>`;
}

function renderSettings(){
  return`<div class="container page-content">
    <h2 style="margin-bottom:24px">Settings</h2>
    <div class="grid-2">
      <div>
        <div class="card" style="margin-bottom:20px">
          <div class="card-body">
            <h3 style="margin-bottom:16px">General</h3>
            <form id="settings-form" name="settingsForm" data-testid="settings-form" action="/settings/save" method="post" aria-label="General settings form" role="form">
              <div class="form-group">
                <label class="form-label" for="company-name">Company Name</label>
                <input class="${dynClass('form-input')}" id="company-name" name="companyName" type="text" data-testid="company-name-input" placeholder="Acme Corp" autocomplete="organization" aria-label="Company name" value="MetricsHQ" />
              </div>
              <div class="form-group">
                <label class="form-label" for="timezone">Timezone</label>
                <select class="${dynClass('form-input')}" id="timezone" name="timezone" data-testid="timezone-select" aria-label="Select timezone">
                  <option value="UTC">UTC</option>
                  <option value="US/Eastern" selected>US/Eastern</option>
                  <option value="US/Pacific">US/Pacific</option>
                  <option value="Europe/London">Europe/London</option>
                </select>
              </div>
              <div class="form-group">
                <label class="form-label" for="currency">Currency</label>
                <select class="${dynClass('form-input')}" id="currency" name="currency" data-testid="currency-select" aria-label="Select currency">
                  <option value="USD" selected>USD ($)</option>
                  <option value="EUR">EUR (€)</option>
                  <option value="GBP">GBP (£)</option>
                </select>
              </div>
              <button id="save-settings-btn" data-testid="save-settings-btn" name="saveSettings" type="submit" class="${dynClass('btn btn-primary')}" aria-label="Save general settings" role="button">Save Settings</button>
            </form>
          </div>
        </div>
      </div>
      <div>
        <div class="card">
          <div class="card-body">
            <h3 style="margin-bottom:16px">Notifications</h3>
            <form id="notif-form" name="notificationsForm" data-testid="notif-form" action="/settings/notifications" method="post" aria-label="Notification settings form" role="form">
              ${['New Order','Low Stock','Payment Failed','New Review'].map((n,i)=>`
              <div class="form-group" style="display:flex;align-items:center;justify-content:space-between">
                <label class="form-label" style="margin:0" for="notif-${i}">${n}</label>
                <input type="checkbox" id="notif-${i}" name="notif${i}" data-testid="notif-toggle-${i}" aria-label="Toggle ${n} notification" ${i<2?'checked':''} />
              </div>`).join('')}
              <button id="save-notif-btn" data-testid="save-notif-btn" name="saveNotifications" type="submit" class="${dynClass('btn btn-primary')}" style="margin-top:8px" aria-label="Save notification settings" role="button">Save</button>
            </form>
          </div>
        </div>
      </div>
    </div>
  </div>`;
}

function attachEvents(){
  document.querySelectorAll('[name="generateReport"]').forEach(btn=>{
    btn.addEventListener('click',()=>showToast('📊 Report generation started...'));
  });
  document.querySelectorAll('[name="downloadReport"]').forEach(btn=>{
    btn.addEventListener('click',()=>showToast('⬇️ Downloading report...'));
  });
  document.querySelectorAll('[name="viewAllOrders"]').forEach(btn=>{
    btn.addEventListener('click',()=>showToast('📋 Loading all orders...'));
  });
  const sf=document.getElementById('settings-form');
  if(sf)sf.addEventListener('submit',e=>{e.preventDefault();showToast('✅ Settings saved!');});
  const nf=document.getElementById('notif-form');
  if(nf)nf.addEventListener('submit',e=>{e.preventDefault();showToast('✅ Notifications updated!');});
  const pf=document.getElementById('profile-form');
  if(pf)pf.addEventListener('submit',e=>{e.preventDefault();showToast('✅ Profile saved!');});
  const dr=document.getElementById('date-range');
  if(dr)dr.addEventListener('change',()=>{showToast(`📅 Showing data for: ${dr.options[dr.selectedIndex].text}`);render();});
  const er=document.getElementById('export-report-btn');
  if(er)er.addEventListener('click',()=>showToast('📤 Exporting report...'));
}
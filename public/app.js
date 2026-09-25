import { FEATURES, filterEventsByFeature, getFeatureLabel, resolveFeature } from './features.js';

const liveStatus = document.getElementById('live-status');
const statsGrid = document.getElementById('stats-grid');
const adoptionStats = document.getElementById('adoption-stats');
const featureSummaryBody = document.getElementById('feature-summary-body');
const featureTabs = document.getElementById('feature-tabs');
const featureDetail = document.getElementById('feature-detail');
const eventsBody = document.getElementById('events-body');
const topClicks = document.getElementById('top-clicks');
const topFeatures = document.getElementById('top-features');
const typeBreakdown = document.getElementById('type-breakdown');
const eventDetail = document.getElementById('event-detail');
const eventCount = document.getElementById('event-count');
const filterType = document.getElementById('filter-type');
const filterFeature = document.getElementById('filter-feature');
const filterSearch = document.getElementById('filter-search');
const filterEmail = document.getElementById('filter-email');

let allEvents = [];
let metrics = null;
let selectedId = null;
let activeView = 'overview';
let activeFeature = 'overview';
let stream = null;

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatTime(timestamp) {
  if (!timestamp) return '—';
  return new Date(Number(timestamp)).toLocaleString();
}

function shortId(value) {
  const text = String(value || '');
  if (!text) return '—';
  return text.length > 10 ? `${text.slice(0, 8)}…` : text;
}

function statCard(label, value) {
  return `
    <div class="stat-card">
      <strong>${Number(value).toLocaleString()}</strong>
      <span>${label}</span>
    </div>
  `;
}

function applyFilters(events) {
  const type = filterType.value;
  const feature = filterFeature.value;
  const search = filterSearch.value.trim().toLowerCase();
  const email = filterEmail.value.trim().toLowerCase();

  return events.filter(event => {
    if (type && event.eventType !== type) return false;
    if (feature && resolveFeature(event) !== feature) return false;
    if (email && !(event.userEmail || '').toLowerCase().includes(email)) return false;
    if (search) {
      const haystack = [
        event.label,
        event.element,
        event.detail,
        event.action,
        event.category,
        getFeatureLabel(resolveFeature(event))
      ].join(' ').toLowerCase();
      if (!haystack.includes(search)) return false;
    }
    return true;
  });
}

function renderGlobalStats() {
  if (!metrics) return;
  statsGrid.innerHTML = [
    ['Extension installs', metrics.extensionInstalls],
    ['Active devices', metrics.activeDevices],
    ['Registered users', metrics.registeredUsers],
    ['Total events', metrics.totalEvents],
    ['Active devices (7d)', metrics.activeDevices7d],
    ['Active devices (30d)', metrics.activeDevices30d]
  ].map(([label, value]) => statCard(label, value)).join('');
}

function renderAdoptionStats() {
  if (!metrics) return;
  adoptionStats.innerHTML = [
    ['Installs tracked', metrics.extensionInstalls],
    ['Updates tracked', metrics.extensionUpdates],
    ['Active devices', metrics.activeDevices],
    ['Registered users', metrics.registeredUsers],
    ['Active devices (7d)', metrics.activeDevices7d],
    ['Active devices (30d)', metrics.activeDevices30d]
  ].map(([label, value]) => statCard(label, value)).join('');
}

function renderFeatureSummary() {
  if (!metrics) return;
  featureSummaryBody.innerHTML = metrics.features
    .filter(item => item.events > 0)
    .map(item => `
      <tr data-feature="${escapeHtml(item.id)}" class="feature-row">
        <td><strong>${escapeHtml(item.label)}</strong></td>
        <td>${item.views.toLocaleString()}</td>
        <td>${item.clicks.toLocaleString()}</td>
        <td>${item.security.toLocaleString()}</td>
        <td>${item.uniqueUsers.toLocaleString()}</td>
        <td>${item.uniqueDevices.toLocaleString()}</td>
        <td>${item.events.toLocaleString()}</td>
      </tr>
    `).join('') || `<tr><td colspan="7">No feature activity yet. Use the extension and events will appear here.</td></tr>`;

  featureSummaryBody.querySelectorAll('.feature-row').forEach(row => {
    row.addEventListener('click', () => {
      activeFeature = row.dataset.feature;
      setActiveView('features');
      renderFeatureTabs();
      renderFeatureDetail();
    });
  });
}

function renderFeatureTabs() {
  const usedFeatures = new Set(
    (metrics?.features || []).filter(item => item.events > 0).map(item => item.id)
  );

  featureTabs.innerHTML = FEATURES
    .filter(item => usedFeatures.has(item.id) || item.id === activeFeature)
    .map(item => `
      <button
        class="feature-tab ${item.id === activeFeature ? 'active' : ''}"
        data-feature="${item.id}"
        type="button"
      >${escapeHtml(item.label)}</button>
    `).join('');

  featureTabs.querySelectorAll('.feature-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      activeFeature = tab.dataset.feature;
      renderFeatureTabs();
      renderFeatureDetail();
    });
  });
}

function renderFeatureDetail() {
  const featureMetrics = metrics?.features.find(item => item.id === activeFeature);
  const featureEvents = filterEventsByFeature(allEvents, activeFeature).slice(0, 40);

  if (!featureMetrics) {
    featureDetail.innerHTML = `<div class="empty-panel">No data for this feature yet.</div>`;
    return;
  }

  featureDetail.innerHTML = `
    <div class="feature-header">
      <div>
        <h2>${escapeHtml(featureMetrics.label)}</h2>
        <p>In-depth usage for this extension feature.</p>
      </div>
    </div>

    <div class="stats-grid compact">
      ${statCard('Views / navigation', featureMetrics.views)}
      ${statCard('Clicks', featureMetrics.clicks)}
      ${statCard('Security events', featureMetrics.security)}
      ${statCard('Unique users', featureMetrics.uniqueUsers)}
      ${statCard('Unique devices', featureMetrics.uniqueDevices)}
      ${statCard('Total events', featureMetrics.events)}
    </div>

    <div class="feature-columns">
      <div class="panel-card">
        <div class="panel-head"><h2>Top actions</h2></div>
        <ul class="rank-list">
          ${featureMetrics.topActions.length
            ? featureMetrics.topActions.map(item => `<li><span>${escapeHtml(item.label)}</span><span>${item.count}</span></li>`).join('')
            : '<li><span>No actions yet</span><span>0</span></li>'}
        </ul>
      </div>
      <div class="panel-card">
        <div class="panel-head"><h2>Top clicks</h2></div>
        <ul class="rank-list">
          ${featureMetrics.topElements.length
            ? featureMetrics.topElements.map(item => `<li><span>${escapeHtml(item.label)}</span><span>${item.count}</span></li>`).join('')
            : '<li><span>No clicks yet</span><span>0</span></li>'}
        </ul>
      </div>
    </div>

    <div class="panel-card">
      <div class="panel-head">
        <h2>Recent events</h2>
        <span class="chip">${featureEvents.length.toLocaleString()} shown</span>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Time</th>
              <th>Type</th>
              <th>Action</th>
              <th>Label / Element</th>
              <th>User</th>
            </tr>
          </thead>
          <tbody>
            ${featureEvents.map(event => `
              <tr>
                <td class="mono">${formatTime(event.timestamp)}</td>
                <td>${escapeHtml(event.eventType || '—')}</td>
                <td>${escapeHtml(event.action || '—')}</td>
                <td>${escapeHtml(event.element || event.label || event.detail || '—')}</td>
                <td>${escapeHtml(event.userEmail || shortId(event.userId))}</td>
              </tr>
            `).join('') || `<tr><td colspan="5">No events for this feature yet.</td></tr>`}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function renderRankList(container, map, max = 8) {
  const items = [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, max);
  container.innerHTML = items.length
    ? items.map(([label, count]) => `<li><span>${escapeHtml(label)}</span><span>${count}</span></li>`).join('')
    : '<li><span>No data yet</span><span>0</span></li>';
}

function renderSidePanels(events) {
  const clicks = new Map();
  const features = new Map();
  const types = new Map();

  for (const event of events) {
    if (event.eventType === 'click') {
      const key = event.element || event.label || 'unknown';
      clicks.set(key, (clicks.get(key) || 0) + 1);
    }
    const feature = getFeatureLabel(resolveFeature(event));
    features.set(feature, (features.get(feature) || 0) + 1);
    const type = event.eventType || 'event';
    types.set(type, (types.get(type) || 0) + 1);
  }

  renderRankList(topClicks, clicks);
  renderRankList(topFeatures, features);
  renderRankList(typeBreakdown, types);
}

function updateFeatureFilterOptions() {
  const current = filterFeature.value;
  const features = [...new Set(allEvents.map(event => resolveFeature(event)).filter(Boolean))].sort();
  filterFeature.innerHTML = '<option value="">All</option>' +
    features.map(feature => `<option value="${escapeHtml(feature)}">${escapeHtml(getFeatureLabel(feature))}</option>`).join('');
  if (features.includes(current)) filterFeature.value = current;
}

function renderEvents(events) {
  const filtered = applyFilters(events);
  renderSidePanels(filtered);
  updateFeatureFilterOptions();
  eventCount.textContent = `${filtered.length.toLocaleString()} events`;

  eventsBody.innerHTML = filtered.map(event => `
    <tr data-id="${escapeHtml(event.id)}" class="${event.id === selectedId ? 'selected' : ''}">
      <td class="mono">${formatTime(event.timestamp)}</td>
      <td>${escapeHtml(event.eventType || '—')}</td>
      <td>${escapeHtml(getFeatureLabel(resolveFeature(event)))}</td>
      <td>${escapeHtml(event.action || '—')}</td>
      <td>${escapeHtml(event.element || event.label || event.detail || '—')}</td>
      <td>${escapeHtml(event.userEmail || shortId(event.userId))}</td>
      <td class="mono">${shortId(event.deviceId)}</td>
      <td>${escapeHtml(event.extensionVersion || '—')}</td>
    </tr>
  `).join('') || `<tr><td colspan="8">No events match your filters.</td></tr>`;

  eventsBody.querySelectorAll('tr[data-id]').forEach(row => {
    row.addEventListener('click', () => {
      selectedId = row.dataset.id;
      const event = allEvents.find(item => item.id === selectedId);
      eventDetail.textContent = event ? JSON.stringify(event, null, 2) : 'Event not found.';
      renderEvents(allEvents);
    });
  });
}

function setActiveView(view) {
  activeView = view;
  document.querySelectorAll('.main-tab').forEach(tab => {
    tab.classList.toggle('active', tab.dataset.view === view);
  });
  document.querySelectorAll('.view-panel').forEach(panel => {
    panel.classList.toggle('active', panel.id === `view-${view}`);
  });
  if (view === 'features') {
    renderFeatureTabs();
    renderFeatureDetail();
  }
}

async function loadMetrics() {
  const response = await fetch('/api/metrics');
  if (!response.ok) throw new Error('Failed to load metrics');
  metrics = await response.json();
  renderGlobalStats();
  renderAdoptionStats();
  renderFeatureSummary();
  if (activeView === 'features') {
    renderFeatureTabs();
    renderFeatureDetail();
  }
}

async function loadEvents() {
  const response = await fetch('/api/events');
  if (!response.ok) throw new Error('Failed to load events');
  const data = await response.json();
  allEvents = Array.isArray(data.events) ? data.events : [];
  renderEvents(allEvents);
  await loadMetrics();
}

function upsertEvent(event) {
  const index = allEvents.findIndex(item => item.id === event.id);
  if (index >= 0) {
    allEvents[index] = event;
  } else {
    allEvents.unshift(event);
  }
  renderEvents(allEvents);
  loadMetrics().catch(() => {});
}

function connectStream() {
  if (stream) stream.close();
  stream = new EventSource('/api/events/stream');

  stream.addEventListener('snapshot', event => {
    const payload = JSON.parse(event.data);
    allEvents = Array.isArray(payload.events) ? payload.events : [];
    renderEvents(allEvents);
    loadMetrics().catch(() => {});
    liveStatus.textContent = `Live · ${allEvents.length.toLocaleString()} stored on server · connected`;
  });

  stream.addEventListener('event', event => {
    upsertEvent(JSON.parse(event.data));
    liveStatus.textContent = `Live · ${allEvents.length.toLocaleString()} stored on server · connected`;
  });

  stream.addEventListener('clear', () => {
    allEvents = [];
    metrics = null;
    selectedId = null;
    eventDetail.textContent = 'Select a row to inspect metadata.';
    renderEvents(allEvents);
    renderGlobalStats();
    renderAdoptionStats();
    renderFeatureSummary();
  });

  stream.onerror = () => {
    liveStatus.textContent = 'Reconnecting to live stream…';
  };
}

function exportCsv() {
  const filtered = applyFilters(allEvents);
  const headers = ['timestamp', 'eventType', 'feature', 'page', 'action', 'label', 'element', 'detail', 'userEmail', 'deviceId', 'sessionId', 'extensionVersion'];
  const lines = [headers.join(',')];
  for (const event of filtered) {
    const row = {
      ...event,
      feature: resolveFeature(event)
    };
    lines.push(headers.map(key => `"${String(row[key] ?? '').replace(/"/g, '""')}"`).join(','));
  }
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `browsersentry-analytics-${Date.now()}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

document.querySelectorAll('.main-tab').forEach(tab => {
  tab.addEventListener('click', () => setActiveView(tab.dataset.view));
});

document.getElementById('refresh-btn').addEventListener('click', () => loadEvents().catch(() => {}));
document.getElementById('export-btn').addEventListener('click', exportCsv);
document.getElementById('clear-btn').addEventListener('click', async () => {
  if (!confirm('Clear all analytics events on the server?')) return;
  await fetch('/api/events', { method: 'DELETE' });
  selectedId = null;
  eventDetail.textContent = 'Select a row to inspect metadata.';
  allEvents = [];
  metrics = null;
  renderEvents(allEvents);
  renderGlobalStats();
  renderAdoptionStats();
  renderFeatureSummary();
});

[filterType, filterFeature, filterSearch, filterEmail].forEach(el => {
  el.addEventListener('input', () => renderEvents(allEvents));
  el.addEventListener('change', () => renderEvents(allEvents));
});

loadEvents()
  .then(() => connectStream())
  .catch(() => {
    liveStatus.textContent = 'Could not reach analytics server. Start it with: npm start (in analytics-server/)';
  });
